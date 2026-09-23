import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  AnalysisArtifactCache,
  createStageCacheKey,
  IndexedDbArtifactStore,
  MemoryArtifactStore,
  sha256Blob,
  type ArtifactStore,
  type StageCacheIdentity,
} from './analysisCache'

const identity = (overrides: Partial<StageCacheIdentity> = {}): StageCacheIdentity => ({
  sourceVideoSha256: 'sha256:video-a',
  stageId: 'ball-observations',
  implementationVersion: '1.0.0',
  providerId: 'provider-a',
  providerVersion: '1.0.0',
  modelId: 'model-family-a',
  modelVersion: 'model-a',
  runtimeId: 'onnxruntime-web',
  runtimeVersion: '1.20.0',
  checkpointHash: 'sha256:checkpoint-a',
  preprocessingConfigHash: 'sha256:config-a',
  contractVersion: 'ball-track.v2',
  decoderTimelineVersion: 'decoder-v1',
  upstreamArtifactHashes: ['sha256:decode'],
  dependencyArtifactHashes: ['sha256:source'],
  ...overrides,
})
const valid = (value: unknown): value is { value: number } =>
  Boolean(value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'number')

describe('AnalysisArtifactCache', () => {
  it('aborts source hashing before publishing an identity', async () => {
    const controller = new AbortController()
    const hashing = sha256Blob(new Blob([new Uint8Array(4 * 1024 * 1024)]), controller.signal)
    controller.abort()
    await expect(hashing).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reuses an exact immutable key', async () => {
    const cache = new AnalysisArtifactCache(new MemoryArtifactStore())
    await cache.write(identity(), { value: 1 }, valid)
    expect(await cache.read(identity(), valid)).toMatchObject({ status: 'hit', artifact: { payload: { value: 1 } } })
  })

  it.each([
    ['video', { sourceVideoSha256: 'sha256:video-b' }],
    ['model ID', { modelId: 'model-family-b' }],
    ['model', { modelVersion: 'model-b' }],
    ['runtime ID', { runtimeId: 'webnn' }],
    ['runtime version', { runtimeVersion: '2.0.0' }],
    ['checkpoint', { checkpointHash: 'sha256:checkpoint-b' }],
    ['config', { preprocessingConfigHash: 'sha256:config-b' }],
    ['contract', { contractVersion: 'ball-track.v3' }],
    ['decoder', { decoderTimelineVersion: 'decoder-v2' }],
  ])('invalidates on %s identity changes', async (_, change) => {
    expect(await createStageCacheKey(identity(change))).not.toBe(await createStageCacheKey(identity()))
  })

  it('invalidates ball descendants without invalidating independent player pose', async () => {
    const pose = identity({
      stageId: 'player-pose',
      providerId: 'pose',
      modelVersion: 'pose-v1',
      checkpointHash: 'sha256:pose',
      dependencyArtifactHashes: ['sha256:decode'],
    })
    const ballA = identity({ dependencyArtifactHashes: ['sha256:decode'] })
    const ballB = identity({ modelVersion: 'model-b', checkpointHash: 'sha256:checkpoint-b', dependencyArtifactHashes: ['sha256:decode'] })
    const trajectoryA = identity({ stageId: 'trajectory', dependencyArtifactHashes: [await createStageCacheKey(ballA)] })
    const trajectoryB = identity({ stageId: 'trajectory', dependencyArtifactHashes: [await createStageCacheKey(ballB)] })
    expect(await createStageCacheKey(pose)).toBe(await createStageCacheKey({ ...pose }))
    expect(await createStageCacheKey(ballA)).not.toBe(await createStageCacheKey(ballB))
    expect(await createStageCacheKey(trajectoryA)).not.toBe(await createStageCacheKey(trajectoryB))
  })

  it('never publishes cancelled or partial artifacts', async () => {
    const store = new MemoryArtifactStore()
    const cache = new AnalysisArtifactCache(store)
    const controller = new AbortController()
    controller.abort()
    await expect(cache.write(identity(), { value: 1 }, valid, controller.signal)).rejects.toThrow()
    expect(store.committed.size).toBe(0)
    await expect(cache.write(identity(), { partial: true } as unknown as { value: number }, valid)).rejects.toThrow()
    expect(store.committed.size).toBe(0)
  })

  it('rejects and evicts corrupted persisted artifacts', async () => {
    const store = new MemoryArtifactStore()
    const cache = new AnalysisArtifactCache(store)
    const artifact = await cache.write(identity(), { value: 1 }, valid)
    store.committed.set(artifact.cacheKey, { ...artifact, payload: { value: 2 } })
    const reloaded = new AnalysisArtifactCache(store)
    expect(await reloaded.read(identity(), valid)).toMatchObject({ status: 'corrupt' })
    expect(store.committed.has(artifact.cacheKey)).toBe(false)
  })

  it('recomputes and rejects a tampered artifact hash from IndexedDB', async () => {
    const store = new IndexedDbArtifactStore(new IDBFactory(), `cache-tampered-${crypto.randomUUID()}`)
    const cache = new AnalysisArtifactCache(store)
    const artifact = await cache.write(identity(), { value: 1 }, valid)
    await store.commit('tamper', artifact.cacheKey, { ...artifact, artifactHash: 'sha256:tampered' })

    const reloaded = new AnalysisArtifactCache(store)
    expect(await reloaded.read(identity(), valid)).toMatchObject({ status: 'corrupt' })
    expect(await store.get(artifact.cacheKey)).toBeUndefined()
  })

  it('deletes the exact committed artifact when cancellation arrives after an IndexedDB commit', async () => {
    const controller = new AbortController()
    const backing = new IndexedDbArtifactStore(new IDBFactory(), `cache-mid-commit-${crypto.randomUUID()}`)
    const store: ArtifactStore = {
      get: (key) => backing.get(key),
      delete: (key) => backing.delete(key),
      deleteIfMatch: (key, hash) => backing.deleteIfMatch(key, hash),
      clear: () => backing.clear(),
      commit: async (tempKey, key, artifact) => {
        await backing.commit(tempKey, key, artifact)
        controller.abort()
      },
    }
    const cache = new AnalysisArtifactCache(store)

    await expect(cache.write(identity(), { value: 1 }, valid, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(await backing.get(await createStageCacheKey(identity()))).toBeUndefined()
  })

  it('does not republish an IndexedDB artifact after a clear/write race', async () => {
    const backing = new IndexedDbArtifactStore(new IDBFactory(), `cache-clear-race-${crypto.randomUUID()}`)
    let releaseCommit!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const released = new Promise<void>((resolve) => { releaseCommit = resolve })
    const store: ArtifactStore = {
      get: (key) => backing.get(key),
      delete: (key) => backing.delete(key),
      deleteIfMatch: (key, hash) => backing.deleteIfMatch(key, hash),
      clear: () => backing.clear(),
      commit: async (tempKey, key, artifact) => {
        markStarted()
        await released
        await backing.commit(tempKey, key, artifact)
      },
    }
    const cache = new AnalysisArtifactCache(store)
    const writing = cache.write(identity(), { value: 1 }, valid)
    await started
    await cache.clear()
    releaseCommit()

    await expect(writing).rejects.toMatchObject({ name: 'AbortError' })
    expect(await backing.get(await createStageCacheKey(identity()))).toBeUndefined()
  })

  it('surfaces IndexedDB transaction and quota failures without publishing artifacts', async () => {
    const backing = new IndexedDbArtifactStore(new IDBFactory(), `cache-failures-${crypto.randomUUID()}`)
    await expect(backing.commit(
      'invalid',
      'invalid',
      { cannotClone: () => undefined },
    )).rejects.toBeTruthy()
    expect(await backing.get('invalid')).toBeUndefined()

    const quotaStore: ArtifactStore = {
      get: (key) => backing.get(key),
      delete: (key) => backing.delete(key),
      deleteIfMatch: (key, hash) => backing.deleteIfMatch(key, hash),
      clear: () => backing.clear(),
      commit: async () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      },
    }
    const cache = new AnalysisArtifactCache(quotaStore)
    await expect(cache.write(identity(), { value: 1 }, valid))
      .rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(await backing.get(await createStageCacheKey(identity()))).toBeUndefined()
  })

  it.each([
    ['Blob', { nested: new Blob(['pixels']) }],
    ['blob URL', { nested: { url: 'blob:private-video' } }],
    ['pixel buffer', { nested: new Uint8ClampedArray([1, 2, 3]) }],
  ])('rejects forbidden persistent %s payloads', async (_, payload) => {
    const cache = new AnalysisArtifactCache(
      new IndexedDbArtifactStore(new IDBFactory(), `cache-media-${crypto.randomUUID()}`),
    )
    await expect(cache.write(
      identity(),
      payload,
      (value): value is typeof payload => value === payload,
    )).rejects.toThrow(/cannot contain|canonical JSON/)
  })
})
