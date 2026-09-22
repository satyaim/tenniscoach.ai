export type AnalysisStageId =
  | 'source-metadata'
  | 'decode-index'
  | 'player-pose'
  | 'chapters'
  | 'ball-observations'
  | 'trajectory'
  | 'court-geometry'
  | 'stroke-analysis'

export interface StageCacheIdentity {
  sourceVideoSha256: string
  stageId: AnalysisStageId
  implementationVersion: string
  providerId: string
  providerVersion: string
  modelId: string
  modelVersion: string
  runtimeId: string
  runtimeVersion: string
  checkpointHash: string
  preprocessingConfigHash: string
  contractVersion: string
  decoderTimelineVersion: string
  upstreamArtifactHashes: string[]
  dependencyArtifactHashes: string[]
}

export interface CachedArtifactEnvelope<T> {
  envelopeVersion: 1
  status: 'complete'
  cacheKey: string
  identity: StageCacheIdentity
  payloadHash: string
  artifactHash: string
  createdAt: string
  payload: T
}

export type CacheReadStatus = 'hit' | 'miss' | 'stale' | 'incompatible' | 'corrupt'

export interface CacheReadResult<T> {
  status: CacheReadStatus
  artifact?: CachedArtifactEnvelope<T>
  reason?: string
}

const forbiddenConstructor = (value: unknown, name: string) => {
  const constructor = globalThis[name as keyof typeof globalThis]
  return typeof constructor === 'function' && value instanceof constructor
}

const assertPersistentPayloadSafe = (value: unknown, seen = new WeakSet<object>()) => {
  if (typeof value === 'string' && value.startsWith('blob:')) {
    throw new Error('Persistent cache payloads cannot contain blob: URLs.')
  }
  if (
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    forbiddenConstructor(value, 'File') ||
    forbiddenConstructor(value, 'VideoFrame') ||
    forbiddenConstructor(value, 'ImageBitmap') ||
    forbiddenConstructor(value, 'ImageData') ||
    (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)
  ) {
    throw new Error('Persistent cache payloads cannot contain media objects or pixel buffers.')
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error('Persistent cache payloads must be canonical JSON values.')
  }
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) throw new Error('Persistent cache payloads cannot contain cycles.')
  seen.add(value)
  for (const child of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    assertPersistentPayloadSafe(child, seen)
  }
  seen.delete(value)
}

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Cache identities and payloads require finite numbers.')
  }
  return value
}

export const canonicalJson = (value: unknown) => JSON.stringify(canonicalValue(value))

export const sha256Text = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')}`
}

export const sha256Blob = async (blob: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')}`
}

const normalizedIdentity = (identity: StageCacheIdentity): StageCacheIdentity => ({
  ...identity,
  upstreamArtifactHashes: [...identity.upstreamArtifactHashes].sort(),
  dependencyArtifactHashes: [...identity.dependencyArtifactHashes].sort(),
})

export const createStageCacheKey = (identity: StageCacheIdentity) =>
  sha256Text(canonicalJson(normalizedIdentity(identity)))

export interface ArtifactStore {
  get(key: string): Promise<unknown>
  commit(tempKey: string, key: string, artifact: unknown): Promise<void>
  delete(key: string): Promise<void>
  deleteIfMatch(key: string, artifactHash: string): Promise<void>
  clear(): Promise<void>
}

export class MemoryArtifactStore implements ArtifactStore {
  readonly committed = new Map<string, unknown>()
  readonly temporary = new Map<string, unknown>()

  async get(key: string) {
    return this.committed.get(key)
  }

  async commit(tempKey: string, key: string, artifact: unknown) {
    this.temporary.set(tempKey, artifact)
    this.committed.set(key, artifact)
    this.temporary.delete(tempKey)
  }

  async delete(key: string) {
    this.committed.delete(key)
  }

  async deleteIfMatch(key: string, artifactHash: string) {
    const artifact = this.committed.get(key) as Partial<CachedArtifactEnvelope<unknown>> | undefined
    if (artifact?.artifactHash === artifactHash) this.committed.delete(key)
  }

  async clear() {
    this.committed.clear()
    this.temporary.clear()
  }
}

export class IndexedDbArtifactStore implements ArtifactStore {
  private readonly database: Promise<IDBDatabase>

  constructor(
    private readonly indexedDb: IDBFactory = indexedDB,
    private readonly databaseName = 'baseline-analysis-cache-v1',
  ) {
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDb.open(this.databaseName, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('artifacts')) request.result.createObjectStore('artifacts')
        if (!request.result.objectStoreNames.contains('temporary')) request.result.createObjectStore('temporary')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  private async request<T>(request: IDBRequest<T>) {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async get(key: string) {
    const database = await this.database
    return this.request(database.transaction('artifacts').objectStore('artifacts').get(key))
  }

  async commit(tempKey: string, key: string, artifact: unknown) {
    const database = await this.database
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['temporary', 'artifacts'], 'readwrite')
      transaction.objectStore('temporary').put(artifact, tempKey)
      transaction.objectStore('artifacts').put(artifact, key)
      transaction.objectStore('temporary').delete(tempKey)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  }

  async delete(key: string) {
    const database = await this.database
    await this.request(database.transaction('artifacts', 'readwrite').objectStore('artifacts').delete(key))
  }

  async deleteIfMatch(key: string, artifactHash: string) {
    const database = await this.database
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('artifacts', 'readwrite')
      const store = transaction.objectStore('artifacts')
      const request = store.get(key)
      request.onsuccess = () => {
        const artifact = request.result as Partial<CachedArtifactEnvelope<unknown>> | undefined
        if (artifact?.artifactHash === artifactHash) store.delete(key)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new DOMException('Cache delete aborted.', 'AbortError'))
    })
  }

  async clear() {
    const database = await this.database
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['temporary', 'artifacts'], 'readwrite')
      transaction.objectStore('temporary').clear()
      transaction.objectStore('artifacts').clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }
}

const isEnvelope = (value: unknown): value is CachedArtifactEnvelope<unknown> => {
  if (!value || typeof value !== 'object') return false
  const artifact = value as Partial<CachedArtifactEnvelope<unknown>>
  return (
    artifact.envelopeVersion === 1 &&
    artifact.status === 'complete' &&
    typeof artifact.cacheKey === 'string' &&
    typeof artifact.payloadHash === 'string' &&
    typeof artifact.artifactHash === 'string' &&
    typeof artifact.createdAt === 'string' &&
    Boolean(artifact.identity)
  )
}

const calculateArtifactHash = (artifact: Omit<CachedArtifactEnvelope<unknown>, 'artifactHash' | 'payload'>) =>
  sha256Text(canonicalJson(artifact))

export class AnalysisArtifactCache {
  private readonly memory = new Map<string, unknown>()
  private generation = 0

  constructor(private readonly store: ArtifactStore) {}

  async read<T>(
    identity: StageCacheIdentity,
    validate: (value: unknown) => value is T,
  ): Promise<CacheReadResult<T>> {
    const cacheKey = await createStageCacheKey(identity)
    let stored = this.memory.get(cacheKey)
    try {
      stored ??= await this.store.get(cacheKey)
    } catch (error) {
      return { status: 'incompatible', reason: error instanceof Error ? error.message : 'Cache read failed.' }
    }
    if (stored === undefined) return { status: 'miss' }
    if (!isEnvelope(stored)) {
      this.memory.delete(cacheKey)
      return { status: 'corrupt', reason: 'Artifact envelope is invalid and was ignored.' }
    }
    if (stored.cacheKey !== cacheKey || canonicalJson(stored.identity) !== canonicalJson(normalizedIdentity(identity))) {
      await this.store.deleteIfMatch(cacheKey, stored.artifactHash).catch(() => undefined)
      this.memory.delete(cacheKey)
      return { status: 'stale', reason: 'Artifact identity no longer matches.' }
    }
    let payloadHash: string
    let artifactHash: string
    try {
      assertPersistentPayloadSafe(stored.payload)
      payloadHash = await sha256Text(canonicalJson(stored.payload))
      artifactHash = await calculateArtifactHash({
        envelopeVersion: stored.envelopeVersion,
        status: stored.status,
        cacheKey: stored.cacheKey,
        identity: stored.identity,
        payloadHash: stored.payloadHash,
        createdAt: stored.createdAt,
      })
    } catch {
      payloadHash = ''
      artifactHash = ''
    }
    if (payloadHash !== stored.payloadHash || artifactHash !== stored.artifactHash || !validate(stored.payload)) {
      await this.store.deleteIfMatch(cacheKey, stored.artifactHash).catch(() => undefined)
      this.memory.delete(cacheKey)
      return { status: 'corrupt', reason: 'Artifact failed payload, envelope hash, privacy, or semantic validation.' }
    }
    this.memory.set(cacheKey, stored)
    return { status: 'hit', artifact: stored as CachedArtifactEnvelope<T> }
  }

  async write<T>(
    identity: StageCacheIdentity,
    payload: T,
    validate: (value: unknown) => value is T,
    signal?: AbortSignal,
  ) {
    const writeGeneration = this.generation
    if (signal?.aborted) throw new DOMException('Cache write cancelled.', 'AbortError')
    if (!validate(payload)) throw new Error('Refusing to cache an invalid or partial artifact.')
    assertPersistentPayloadSafe(payload)
    const normalized = normalizedIdentity(identity)
    const cacheKey = await createStageCacheKey(normalized)
    const payloadHash = await sha256Text(canonicalJson(payload))
    const createdAt = new Date().toISOString()
    const artifactWithoutHash = {
      envelopeVersion: 1,
      status: 'complete',
      cacheKey,
      identity: normalized,
      payloadHash,
      createdAt,
    } as const
    const artifact: CachedArtifactEnvelope<T> = {
      ...artifactWithoutHash,
      artifactHash: await calculateArtifactHash(artifactWithoutHash),
      payload,
    }
    if (signal?.aborted || writeGeneration !== this.generation) {
      throw new DOMException('Cache write cancelled.', 'AbortError')
    }
    await this.store.commit(`temporary:${cacheKey}:${crypto.randomUUID()}`, cacheKey, artifact)
    if (signal?.aborted || writeGeneration !== this.generation) {
      await this.store.deleteIfMatch(cacheKey, artifact.artifactHash).catch(() => undefined)
      throw new DOMException('Cache write invalidated before publication.', 'AbortError')
    }
    this.memory.set(cacheKey, artifact)
    return artifact
  }

  async clear() {
    this.generation += 1
    this.memory.clear()
    await this.store.clear()
  }
}

export const analysisCache = new AnalysisArtifactCache(
  typeof indexedDB === 'undefined' ? new MemoryArtifactStore() : new IndexedDbArtifactStore(),
)
