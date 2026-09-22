import type { QualityBand } from './types'

export const BALL_TRACK_SCHEMA_VERSION = 'ball-track.v2' as const

export type BallFrameState =
  | 'visible'
  | 'ambiguous'
  | 'occluded'
  | 'absent'
  | 'abstained'

export type BallPointProvenance =
  | 'learned-observation'
  | 'learned-trajectory'
  | 'none'

export interface ModelArtifactRecord {
  name: string
  sourceUrl: string
  sha256: string
  sizeBytes: number
  localDisposition: 'quarantined-uncommitted' | 'not-present'
  license: string
}

export interface BallModelManifest {
  adapterId: string
  component: 'observation' | 'trajectory' | 'temporal-event'
  modelName: string
  modelVersion: string
  runtime: string
  upstreamRepository: string
  upstreamCommit: string
  licenseCommit: string
  codeLicense: string
  checkpointLicense: string
  frameworkLicense: string
  annotationRights: string
  trainingMediaRights: string
  trainingDomain: string
  targetDomain: 'tennis-ball'
  benchmarkConditions: string
  transferabilityWarning: string
  artifacts: ModelArtifactRecord[]
  deviationsFromUpstream: string[]
  frameworkVersions?: Record<string, string>
}

export interface BallObservation {
  id: string
  timestampMs: number
  frameIndex: number
  center?: { x: number; y: number }
  radius?: number
  detectorConfidence?: number
  heatmapPeak?: number
  candidateCount?: number
  evidenceQuality: QualityBand
  status: BallFrameState
  provenance: 'learned-observation' | 'none'
  uncertaintyPx?: number
  limitations: string[]
}

export interface BallInpaintedPoint {
  id: string
  timestampMs: number
  frameIndex: number
  center?: { x: number; y: number }
  status: 'model-inferred' | 'abstained'
  provenance: 'learned-trajectory' | 'none'
  uncertaintyPx?: number
  sourceGap: {
    startFrame: number
    endFrame: number
    lengthFrames: number
  }
  limitations: string[]
}

export interface BallFrameRecord {
  frameIndex: number
  timestampMs: number
  state: BallFrameState
  provenance: BallPointProvenance
  observationId?: string
  inpaintedPointId?: string
}

export interface BallTrack {
  id: string
  startMs: number
  endMs: number
  observationIds: string[]
  inpaintedPointIds: string[]
  completeness: number
  temporalContinuity: number
  evidenceQuality: QualityBand
  status: 'complete' | 'partial' | 'withheld'
  warnings: string[]
}

export interface BallTrackingStageMetrics {
  status: 'complete' | 'partial' | 'unavailable' | 'cancelled'
  processedFrames: number
  processingDurationMs: number
  inferenceFps: number
  warmupDurationMs: number
  cpuPeakMemoryBytes?: number
  gpuPeakMemoryBytes?: number
  decodeDurationMs?: number
  preprocessDurationMs?: number
  inferenceDurationMs?: number
  postprocessDurationMs?: number
  duplicateFrames?: number
  reorderedFrames?: number
  failure?: string
}

export interface BallTrackingMetrics {
  expectedFrames?: number
  processedFrames: number
  accountedFrames: number
  sourceFps: number
  processingDurationMs: number
  endToEndFps: number
  droppedFrames: number
  gapsPresented: number
  gapsRepaired: number
  repairedFrames: number
  abstainedFrames: number
  pathologicalTrajectories: number
  observation: BallTrackingStageMetrics
  inpainting: BallTrackingStageMetrics
}

export interface BallTrackingResult {
  schemaVersion: typeof BALL_TRACK_SCHEMA_VERSION
  runId: string
  status: 'complete' | 'partial' | 'unavailable' | 'cancelled'
  source: {
    kind: 'ordinary-rgb-video'
    width: number
    height: number
    durationMs: number
    fps: number
    frameCount?: number
    sha256?: string
  }
  model?: BallModelManifest
  observations: BallObservation[]
  inpaintedPoints: BallInpaintedPoint[]
  frames: BallFrameRecord[]
  tracks: BallTrack[]
  metrics: BallTrackingMetrics
  abstentionReason?: string
  failures: string[]
  limitations: string[]
}

export interface BallTrackingInput {
  runId: string
  video: HTMLVideoElement
  signal?: AbortSignal
}

export interface BallTrackingProgress {
  stage: 'observation' | 'inpainting'
  processedFrames: number
  estimatedTotalFrames?: number
  latestObservations: BallObservation[]
  latestInpaintedPoints: BallInpaintedPoint[]
}

export interface BallTrackerAdapter {
  readonly id: string
  readonly schemaVersion: typeof BALL_TRACK_SCHEMA_VERSION
  track(
    input: BallTrackingInput,
    onProgress?: (progress: BallTrackingProgress) => void,
  ): Promise<BallTrackingResult>
}

const unavailableStageMetrics = (): BallTrackingStageMetrics => ({
  status: 'unavailable',
  processedFrames: 0,
  processingDurationMs: 0,
  inferenceFps: 0,
  warmupDurationMs: 0,
})

export const unavailableBallTrackingResult = (
  runId: string,
  source: BallTrackingResult['source'],
  reason: string,
  model?: BallModelManifest,
): BallTrackingResult => ({
  schemaVersion: BALL_TRACK_SCHEMA_VERSION,
  runId,
  status: 'unavailable',
  source,
  model,
  observations: [],
  inpaintedPoints: [],
  frames: [],
  tracks: [],
  metrics: {
    expectedFrames: source.frameCount,
    processedFrames: 0,
    accountedFrames: 0,
    sourceFps: source.fps,
    processingDurationMs: 0,
    endToEndFps: 0,
    droppedFrames: 0,
    gapsPresented: 0,
    gapsRepaired: 0,
    repairedFrames: 0,
    abstainedFrames: 0,
    pathologicalTrajectories: 0,
    observation: unavailableStageMetrics(),
    inpainting: unavailableStageMetrics(),
  },
  abstentionReason: reason,
  failures: [reason],
  limitations: [
    'No ball position or trajectory claim is available.',
    'No contact, bounce, speed, or spin claim is produced by this experiment.',
    'No learned checkpoint is installed or adopted by the Phase 0 product.',
  ],
})

const isFinitePoint = (point: { x: number; y: number } | undefined) =>
  point === undefined || (Number.isFinite(point.x) && Number.isFinite(point.y))

const hasUniqueFrameAccounting = (result: BallTrackingResult) => {
  const indexes = new Set(result.frames.map((frame) => frame.frameIndex))
  if (indexes.size !== result.frames.length) return false
  if (result.metrics.accountedFrames !== result.frames.length) return false
  if (result.status === 'unavailable') {
    return result.frames.every((frame) =>
      frame.state === 'abstained' && frame.provenance === 'none')
  }
  if (result.source.frameCount === undefined) return true
  return result.status === 'complete'
    ? result.frames.length === result.source.frameCount
    : result.frames.length <= result.source.frameCount
}

export const isBallTrackingResult = (value: unknown): value is BallTrackingResult => {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<BallTrackingResult>
  if (
    result.schemaVersion !== BALL_TRACK_SCHEMA_VERSION ||
    typeof result.runId !== 'string' ||
    !['complete', 'partial', 'unavailable', 'cancelled'].includes(result.status ?? '') ||
    result.source?.kind !== 'ordinary-rgb-video' ||
    !Number.isFinite(result.source.fps) ||
    !Array.isArray(result.observations) ||
    !Array.isArray(result.inpaintedPoints) ||
    !Array.isArray(result.frames) ||
    !Array.isArray(result.tracks) ||
    !Array.isArray(result.failures) ||
    !Array.isArray(result.limitations) ||
    !result.metrics
  ) {
    return false
  }

  const observationsValid = result.observations.every((observation) =>
    Number.isInteger(observation.frameIndex) &&
    Number.isFinite(observation.timestampMs) &&
    isFinitePoint(observation.center) &&
    ['visible', 'ambiguous', 'occluded', 'absent', 'abstained'].includes(observation.status) &&
    ['learned-observation', 'none'].includes(observation.provenance))

  const inpaintedPointsValid = result.inpaintedPoints.every((point) =>
    Number.isInteger(point.frameIndex) &&
    Number.isFinite(point.timestampMs) &&
    isFinitePoint(point.center) &&
    (point.status === 'model-inferred' || point.status === 'abstained') &&
    (point.provenance === 'learned-trajectory' || point.provenance === 'none'))

  return observationsValid && inpaintedPointsValid && hasUniqueFrameAccounting(result as BallTrackingResult)
}
