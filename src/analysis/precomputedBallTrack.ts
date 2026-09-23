import { sha256Text } from './analysisCache'

export const PRECOMPUTED_BALL_MANIFEST_PATHS = [
  '/ball-tracks/manifest.json',
  '/ball-tracks/manifest.v1.json',
] as const

export const PRECOMPUTED_BALL_MANIFEST_VERSION = 'precomputed-ball-tracks.v1'
export const PRECOMPUTED_BALL_TRACK_VERSION = 'precomputed-ball-track.v1'
export const PRECOMPUTED_BALL_PROVIDER_REVISION = 'precomputed-ball-provider.v1'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_DURATION_DIFFERENCE_MS = 20

export type BallFrameState = 'observed' | 'ambiguous' | 'abstained'

export interface BallCoordinateSpace {
  kind: 'intrinsic-source-pixels'
  origin: 'top-left'
  xDirection: 'right'
  yDirection: 'down'
  width: number
  height: number
}

export interface PrecomputedBallFrame {
  i: number
  t: number
  s: BallFrameState
  x?: number
  y?: number
  r?: number
  e?: {
    heatmapPeak?: number
    componentMean?: number
    candidateCount?: number
  }
}

export interface PrecomputedBallTrack {
  schemaVersion: typeof PRECOMPUTED_BALL_TRACK_VERSION
  sourceSha256: string
  coordinateSpace: BallCoordinateSpace
  timeline: {
    frameIndexOrigin: 0
    timestampRule: 'frameIndex * 1000 / sourceFps'
    fps: number
    frameCount: number
    durationMs: number
  }
  frames: PrecomputedBallFrame[]
}

interface ManifestSource {
  sha256: string
  bytes: number
  durationMs: number
  width: number
  height: number
  fps: number
  frameCount: number
}

export interface AvailableBallManifestEntry {
  label: string
  status: 'available'
  generation: 'reused' | 'newly-inferred'
  source: ManifestSource
  provider: {
    receiptSha256: string
    adapterId: string
    model: string
    codeRevision: string
    runtime: string
    checkpointSha256: string
    checkpointBytes: number
    runtimeArtifactSha256: string | null
    config: {
      modelInput: '512x288'
      historyFrames: 4
      medianBackground: true
      threshold: 0.5
      ambiguityRatio: 0.35
      interpolation: false
      smoothing: false
      trajectoryRepair: false
    }
  }
  coordinateSpace: BallCoordinateSpace
  measurements: {
    processingDurationMs: number
    peakMemoryBytes: number | null
    frames: number
    states: { observed: number; ambiguous: number; abstained: number }
    observedCoverage: number
  }
  track: { path: string; sha256: string; bytes: number }
  rightsAndProvenanceWarning: string
}

interface UnavailableBallManifestEntry {
  label: string
  status: 'unavailable'
  generation: 'unavailable'
  source: {
    sha256: string
    bytes: number
    durationMs: number | null
    width: number | null
    height: number | null
    fps: number | null
    frameCount: number | null
  }
  provider: {
    receiptSha256: string
    adapterId: string
    model: string
    codeRevision: string
    checkpointSha256: string
  }
  unavailableReason: string
  rightsAndProvenanceWarning: string
}

export interface PrecomputedBallManifest {
  schemaVersion: typeof PRECOMPUTED_BALL_MANIFEST_VERSION
  entries: Record<string, AvailableBallManifestEntry | UnavailableBallManifestEntry>
}

export type BallTrackLoadResult =
  | {
      status: 'available'
      track: PrecomputedBallTrack
      entry: AvailableBallManifestEntry
      cacheIdentity: string
      message: string
    }
  | { status: 'unavailable'; message: string }

export interface BallSourceIdentity {
  sha256: string
  bytes: number
  durationMs: number
  width: number
  height: number
}

const verifiedTrackCache = new Map<string, PrecomputedBallTrack>()

export const clearPrecomputedBallTrackCache = () => verifiedTrackCache.clear()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key))

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isNonNegativeNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0

const isPositiveNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value > 0

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && isNonNegativeNumber(value)

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && isPositiveNumber(value)

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && SHA256_PATTERN.test(value)

const parseCoordinateSpace = (value: unknown): BallCoordinateSpace | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'kind', 'origin', 'xDirection', 'yDirection', 'width', 'height',
  ])) return undefined
  if (
    value.kind !== 'intrinsic-source-pixels'
    || value.origin !== 'top-left'
    || value.xDirection !== 'right'
    || value.yDirection !== 'down'
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
  ) return undefined
  return value as unknown as BallCoordinateSpace
}

const parseSource = (value: unknown): ManifestSource | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'sha256', 'bytes', 'durationMs', 'width', 'height', 'fps', 'frameCount',
  ])) return undefined
  if (
    !isSha256(value.sha256)
    || !isPositiveInteger(value.bytes)
    || !isPositiveNumber(value.durationMs)
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || !isPositiveNumber(value.fps)
    || !isPositiveInteger(value.frameCount)
  ) return undefined
  return value as unknown as ManifestSource
}

const parseUnavailableSource = (value: unknown): UnavailableBallManifestEntry['source'] | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'sha256', 'bytes', 'durationMs', 'width', 'height', 'fps', 'frameCount',
  ])) return undefined
  if (
    !isSha256(value.sha256)
    || !isPositiveInteger(value.bytes)
    || !(value.durationMs === null || isPositiveNumber(value.durationMs))
    || !(value.width === null || isPositiveInteger(value.width))
    || !(value.height === null || isPositiveInteger(value.height))
    || !(value.fps === null || isPositiveNumber(value.fps))
    || !(value.frameCount === null || isPositiveInteger(value.frameCount))
  ) return undefined
  return value as unknown as UnavailableBallManifestEntry['source']
}

const parseAvailableEntry = (value: Record<string, unknown>): AvailableBallManifestEntry | undefined => {
  if (!hasOnlyKeys(value, [
    'label', 'status', 'generation', 'source', 'provider', 'coordinateSpace',
    'measurements', 'track', 'rightsAndProvenanceWarning',
  ])) return undefined
  const source = parseSource(value.source)
  const coordinateSpace = parseCoordinateSpace(value.coordinateSpace)
  if (
    typeof value.label !== 'string'
    || value.status !== 'available'
    || (value.generation !== 'reused' && value.generation !== 'newly-inferred')
    || !source
    || !coordinateSpace
    || coordinateSpace.width !== source.width
    || coordinateSpace.height !== source.height
    || typeof value.rightsAndProvenanceWarning !== 'string'
    || !isRecord(value.provider)
    || !isRecord(value.provider.config)
    || !isRecord(value.measurements)
    || !isRecord(value.measurements.states)
    || !isRecord(value.track)
  ) return undefined
  const provider = value.provider as Record<string, unknown>
  const config = provider.config as Record<string, unknown>
  if (
    !hasOnlyKeys(provider, [
      'receiptSha256', 'adapterId', 'model', 'codeRevision', 'runtime',
      'checkpointSha256', 'checkpointBytes', 'runtimeArtifactSha256', 'config',
    ])
    || !isSha256(provider.receiptSha256)
    || typeof provider.adapterId !== 'string'
    || typeof provider.model !== 'string'
    || typeof provider.codeRevision !== 'string'
    || typeof provider.runtime !== 'string'
    || !isSha256(provider.checkpointSha256)
    || !isPositiveInteger(provider.checkpointBytes)
    || !(provider.runtimeArtifactSha256 === null || isSha256(provider.runtimeArtifactSha256))
    || !hasOnlyKeys(config, [
      'modelInput', 'historyFrames', 'medianBackground', 'threshold', 'ambiguityRatio',
      'interpolation', 'smoothing', 'trajectoryRepair',
    ])
    || config.modelInput !== '512x288'
    || config.historyFrames !== 4
    || config.medianBackground !== true
    || config.threshold !== 0.5
    || config.ambiguityRatio !== 0.35
    || config.interpolation !== false
    || config.smoothing !== false
    || config.trajectoryRepair !== false
  ) return undefined
  const measurements = value.measurements as Record<string, unknown>
  const states = measurements.states as Record<string, unknown>
  if (
    !hasOnlyKeys(measurements, [
      'processingDurationMs', 'peakMemoryBytes', 'frames', 'states', 'observedCoverage',
    ])
    || !isNonNegativeNumber(measurements.processingDurationMs)
    || !(measurements.peakMemoryBytes === null || isNonNegativeInteger(measurements.peakMemoryBytes))
    || !isPositiveInteger(measurements.frames)
    || !hasOnlyKeys(states, ['observed', 'ambiguous', 'abstained'])
    || !isNonNegativeInteger(states.observed)
    || !isNonNegativeInteger(states.ambiguous)
    || !isNonNegativeInteger(states.abstained)
    || states.observed + states.ambiguous + states.abstained !== measurements.frames
    || !isNonNegativeNumber(measurements.observedCoverage)
    || measurements.observedCoverage > 1
    || Math.abs(
      measurements.observedCoverage - states.observed / measurements.frames,
    ) > 1e-6
    || measurements.frames !== source.frameCount
  ) return undefined
  const track = value.track as Record<string, unknown>
  if (
    !hasOnlyKeys(track, ['path', 'sha256', 'bytes'])
    || typeof track.path !== 'string'
    || track.path !== `${source.sha256}.json`
    || track.path.includes('..')
    || !isSha256(track.sha256)
    || !isPositiveInteger(track.bytes)
  ) return undefined
  return value as unknown as AvailableBallManifestEntry
}

export const parseBallManifest = (value: unknown): PrecomputedBallManifest => {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'entries'])
    || value.schemaVersion !== PRECOMPUTED_BALL_MANIFEST_VERSION
    || !isRecord(value.entries)
  ) throw new Error('The precomputed ball manifest has an unsupported or invalid schema.')

  const entries: PrecomputedBallManifest['entries'] = {}
  for (const [hash, candidate] of Object.entries(value.entries)) {
    if (!isSha256(hash) || !isRecord(candidate)) {
      throw new Error('The precomputed ball manifest contains an invalid source identity.')
    }
    if (candidate.status === 'available') {
      const entry = parseAvailableEntry(candidate)
      if (!entry || entry.source.sha256 !== hash) {
        throw new Error('The precomputed ball manifest contains an invalid available entry.')
      }
      entries[hash] = entry
      continue
    }
    const source = parseUnavailableSource(candidate.source)
    const provider = candidate.provider
    if (
      candidate.status !== 'unavailable'
      || !hasOnlyKeys(candidate, [
        'label', 'status', 'generation', 'source', 'provider',
        'unavailableReason', 'rightsAndProvenanceWarning',
      ])
      || typeof candidate.label !== 'string'
      || candidate.generation !== 'unavailable'
      || typeof candidate.unavailableReason !== 'string'
      || typeof candidate.rightsAndProvenanceWarning !== 'string'
      || !source
      || source.sha256 !== hash
      || !isRecord(provider)
      || !hasOnlyKeys(provider, [
        'receiptSha256', 'adapterId', 'model', 'codeRevision', 'checkpointSha256',
      ])
      || !isSha256(provider.receiptSha256)
      || typeof provider.adapterId !== 'string'
      || typeof provider.model !== 'string'
      || typeof provider.codeRevision !== 'string'
      || !isSha256(provider.checkpointSha256)
    ) throw new Error('The precomputed ball manifest contains an invalid unavailable entry.')
    entries[hash] = candidate as unknown as UnavailableBallManifestEntry
  }
  return { schemaVersion: PRECOMPUTED_BALL_MANIFEST_VERSION, entries }
}

const parseEvidence = (value: unknown) => {
  if (value === undefined) return undefined
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'heatmapPeak', 'componentMean', 'candidateCount',
  ])) return undefined
  if (
    value.heatmapPeak !== undefined
      && (!isNonNegativeNumber(value.heatmapPeak) || value.heatmapPeak > 1)
    || value.componentMean !== undefined
      && (!isNonNegativeNumber(value.componentMean) || value.componentMean > 1)
    || value.candidateCount !== undefined && !isNonNegativeInteger(value.candidateCount)
  ) return undefined
  return value as PrecomputedBallFrame['e']
}

export const parseBallTrack = (
  value: unknown,
  entry: AvailableBallManifestEntry,
): PrecomputedBallTrack => {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'schemaVersion', 'sourceSha256', 'coordinateSpace', 'timeline', 'frames',
    ])
    || value.schemaVersion !== PRECOMPUTED_BALL_TRACK_VERSION
    || value.sourceSha256 !== entry.source.sha256
    || !Array.isArray(value.frames)
    || !isRecord(value.timeline)
  ) throw new Error('The precomputed ball track has an unsupported or invalid schema.')
  const coordinateSpace = parseCoordinateSpace(value.coordinateSpace)
  const timeline = value.timeline as Record<string, unknown>
  if (
    !coordinateSpace
    || coordinateSpace.width !== entry.source.width
    || coordinateSpace.height !== entry.source.height
    || !hasOnlyKeys(timeline, [
      'frameIndexOrigin', 'timestampRule', 'fps', 'frameCount', 'durationMs',
    ])
    || timeline.frameIndexOrigin !== 0
    || timeline.timestampRule !== 'frameIndex * 1000 / sourceFps'
    || !isPositiveNumber(timeline.fps)
    || !isPositiveInteger(timeline.frameCount)
    || !isPositiveNumber(timeline.durationMs)
    || timeline.fps !== entry.source.fps
    || timeline.frameCount !== entry.source.frameCount
    || timeline.durationMs !== entry.source.durationMs
    || value.frames.length !== timeline.frameCount
  ) throw new Error('The precomputed ball track timeline does not match its manifest entry.')
  const timelineFps = timeline.fps as number

  const frames = value.frames.map((candidate, index): PrecomputedBallFrame => {
    if (
      !isRecord(candidate)
      || !hasOnlyKeys(candidate, ['i', 't', 's', 'x', 'y', 'r', 'e'])
      || candidate.i !== index
      || !isNonNegativeNumber(candidate.t)
      || Math.abs(candidate.t - index * 1000 / timelineFps) > 0.001001
      || !['observed', 'ambiguous', 'abstained'].includes(candidate.s as string)
    ) throw new Error('The precomputed ball track contains an invalid frame.')
    const evidence = parseEvidence(candidate.e)
    if (candidate.e !== undefined && !evidence) {
      throw new Error('The precomputed ball track contains invalid evidence.')
    }
    if (candidate.s === 'observed') {
      if (
        !isNonNegativeNumber(candidate.x)
        || !isNonNegativeNumber(candidate.y)
        || candidate.x > coordinateSpace.width
        || candidate.y > coordinateSpace.height
        || candidate.r !== undefined && !isNonNegativeNumber(candidate.r)
      ) throw new Error('An observed ball frame is missing a valid source coordinate.')
    } else if (candidate.x !== undefined || candidate.y !== undefined || candidate.r !== undefined) {
      throw new Error('Ambiguous and abstained ball frames cannot contain coordinates.')
    }
    return candidate as unknown as PrecomputedBallFrame
  })
  const stateCounts = frames.reduce((counts, frame) => {
    counts[frame.s] += 1
    return counts
  }, { observed: 0, ambiguous: 0, abstained: 0 })
  if (
    stateCounts.observed !== entry.measurements.states.observed
    || stateCounts.ambiguous !== entry.measurements.states.ambiguous
    || stateCounts.abstained !== entry.measurements.states.abstained
  ) throw new Error('The precomputed ball track state counts do not match its manifest entry.')
  return {
    schemaVersion: PRECOMPUTED_BALL_TRACK_VERSION,
    sourceSha256: value.sourceSha256,
    coordinateSpace,
    timeline: timeline as unknown as PrecomputedBallTrack['timeline'],
    frames,
  }
}

const sourceMatches = (entry: ManifestSource, source: BallSourceIdentity) =>
  entry.sha256 === source.sha256
  && entry.bytes === source.bytes
  && entry.width === source.width
  && entry.height === source.height
  && Math.abs(entry.durationMs - source.durationMs) <= MAX_DURATION_DIFFERENCE_MS

const fetchManifest = async (signal: AbortSignal, fetcher: typeof fetch) => {
  for (const [index, path] of PRECOMPUTED_BALL_MANIFEST_PATHS.entries()) {
    const response = await fetcher(path, { signal, cache: 'no-cache' })
    if (response.ok) return parseBallManifest(await response.json())
    if (response.status !== 404 || index === PRECOMPUTED_BALL_MANIFEST_PATHS.length - 1) {
      throw new Error(`The precomputed ball manifest could not be loaded (${response.status}).`)
    }
  }
  throw new Error('The precomputed ball manifest is unavailable.')
}

export const createBallCacheIdentity = (
  manifest: PrecomputedBallManifest,
  entry: AvailableBallManifestEntry,
) => sha256Text(JSON.stringify({
  providerRevision: PRECOMPUTED_BALL_PROVIDER_REVISION,
  manifestVersion: manifest.schemaVersion,
  sourceSha256: entry.source.sha256,
  trackSha256: entry.track.sha256,
  provider: {
    adapterId: entry.provider.adapterId,
    codeRevision: entry.provider.codeRevision,
    checkpointSha256: entry.provider.checkpointSha256,
    runtimeArtifactSha256: entry.provider.runtimeArtifactSha256,
    config: entry.provider.config,
  },
}))

export const loadPrecomputedBallTrack = async ({
  source,
  signal,
  fetcher = fetch,
}: {
  source: BallSourceIdentity
  signal: AbortSignal
  fetcher?: typeof fetch
}): Promise<BallTrackLoadResult> => {
  const manifest = await fetchManifest(signal, fetcher)
  const entry = manifest.entries[source.sha256]
  if (!entry) return {
    status: 'unavailable',
    message: 'Ball visualization is not available for this exact video.',
  }
  if (entry.status === 'unavailable') return {
    status: 'unavailable',
    message: 'Ball visualization is not available for this exact video.',
  }
  if (!sourceMatches(entry.source, source)) {
    return {
      status: 'unavailable',
      message: 'Ball visualization was withheld because the video metadata did not match.',
    }
  }
  const cacheIdentity = await createBallCacheIdentity(manifest, entry)
  if (signal.aborted) throw new DOMException('Ball track loading cancelled.', 'AbortError')
  const cachedTrack = verifiedTrackCache.get(cacheIdentity)
  if (cachedTrack) return {
    status: 'available',
    track: cachedTrack,
    entry,
    cacheIdentity,
    message: 'Precomputed ball observations are available for this exact video.',
  }

  const trackUrl = new URL(entry.track.path, new URL('/ball-tracks/', window.location.origin))
  if (trackUrl.origin !== window.location.origin) {
    throw new Error('The precomputed ball track must be loaded from the same origin.')
  }
  const response = await fetcher(trackUrl.pathname, { signal, cache: 'force-cache' })
  if (!response.ok) throw new Error(`The precomputed ball track could not be loaded (${response.status}).`)
  const bytes = await response.arrayBuffer()
  if (signal.aborted) throw new DOMException('Ball track loading cancelled.', 'AbortError')
  if (bytes.byteLength !== entry.track.bytes) {
    throw new Error('The precomputed ball track byte length did not match its manifest.')
  }
  const digestBytes = await crypto.subtle.digest('SHA-256', bytes)
  if (signal.aborted) throw new DOMException('Ball track loading cancelled.', 'AbortError')
  const digest = [...new Uint8Array(digestBytes)]
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('')
  if (digest !== entry.track.sha256) {
    throw new Error('The precomputed ball track failed SHA-256 verification.')
  }
  const track = parseBallTrack(JSON.parse(new TextDecoder().decode(bytes)), entry)
  verifiedTrackCache.set(cacheIdentity, track)
  return {
    status: 'available',
    track,
    entry,
    cacheIdentity,
    message: 'Precomputed ball observations are available for this exact video.',
  }
}
