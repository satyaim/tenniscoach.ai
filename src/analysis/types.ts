export type Handedness = 'right' | 'left' | 'unknown'
export type StrokeType = 'auto' | 'forehand' | 'backhand' | 'serve'
export type ResolvedStroke = Exclude<StrokeType, 'auto'> | 'unknown'
export type ReliabilityBand = 'high' | 'medium' | 'low' | 'insufficient'
export type ObservationState = 'present' | 'absent' | 'partial' | 'not_observable' | 'not_applicable'
export type QualityBand = 'good' | 'usable' | 'limited' | 'insufficient'

export interface CaptureContext {
  viewpoint: string
  cameraMotion: 'fixed' | 'moving' | 'unknown'
  cuts: 'none' | 'present' | 'unknown'
  resolution: string
  sourceFps?: number
  samplingConfig: string
  normalizationGeometry: 'shoulder-width-2d-v1'
}

export interface PoseLandmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

export interface PoseFrame {
  timestampMs: number
  poses: PoseLandmark[][]
}

export interface StrokeSegment {
  id: string
  revision: number
  status: 'provisional' | 'final' | 'withheld'
  source: 'automatic' | 'user-adjusted'
  startFrame: number
  onsetFrame: number
  peakFrame: number
  offsetFrame: number
  endFrame: number
  startMs: number
  onsetMs: number
  peakMs: number
  offsetMs: number
  endMs: number
  reliability: ReliabilityBand
  poseEvidence: ReliabilityBand
  boundaryReliability: ReliabilityBand
  boundaryUncertaintyMs: number
  peakWristSpeed?: number
  diagnostics: {
    effectiveFps: number
    medianIntervalMs: number
    intervalIqrMs: number
    maxGapMs: number
    poseCoverage: number
    scaleStability: number
    eventProminence: number
  }
  warnings: string[]
}

export interface AnalysisInput {
  frames: PoseFrame[]
  durationMs: number
  handedness: Handedness
  requestedStroke: StrokeType
  allowStrokeHypothesis?: boolean
  source: 'demo' | 'upload' | 'camera'
  coachingMode?: 'observations-only' | 'reviewed-rubric'
  captureContext: CaptureContext
  segment: StrokeSegment
}

export interface MeasuredObservation {
  id: 'preparation' | 'spacing' | 'pelvisProjection' | 'postPeakPath'
  label: string
  state: ObservationState
  reliability: ReliabilityBand
  evidenceBasis: string
  measuredValue?: number
  unit?: string
  description: string
  abstentionReason?: string
}

export interface KeyMoment {
  id: 'onset' | 'preparation' | 'peak' | 'offset'
  label: string
  timestampMs: number
  note: string
}

export interface AnalysisResult {
  analyzer: string
  source: AnalysisInput['source']
  stroke: ResolvedStroke
  strokeSource: 'hypothesis' | 'selected' | 'unknown'
  strokePresentation: {
    label: string
    provenance: 'automatic' | 'player-selected' | 'unknown'
  }
  handedness: Handedness
  timing: null
  inputQuality: QualityBand
  poseTrackQuality: QualityBand
  segmentationReliability: ReliabilityBand
  observations: MeasuredObservation[]
  mainObservation: string
  coachingNote: string
  drill?: { title: string; instruction: string; evidence: string }
  moments: KeyMoment[]
  peakFrame: number
  segment: StrokeSegment & {
    sampledFrameCount: number
    effectiveFps: number
  }
  trace: Array<{ metric: string; value: number | string; unit: string; interpretation: string }>
  limitations: string[]
  safety: string
  captureContext: CaptureContext
  playerSelection?: {
    selectedPlayerId: 'A' | 'B'
    selectionMethod: 'auto-near' | 'manual'
    recommendationBand: ReliabilityBand
    trackingWarnings: string[]
  }
}

export interface VideoAnalysisRun {
  schemaVersion: 1
  status: 'partial' | 'complete'
  startedAt: string
  completedAt?: string
  segments: Array<{
    id: string
    revision: number
    status: StrokeSegment['status']
    segment: StrokeSegment
    result: AnalysisResult
  }>
  revisionHistory: Array<{
    id: string
    revisions: StrokeSegment[]
  }>
}

export interface EvaluationRecord {
  schemaVersion: 2
  runId: string
  sourceRevision: string
  browserVersion: string
  clipId: string
  title: string
  expected: {
    outcome: 'analyze' | 'reject' | 'unverified'
    stroke: ResolvedStroke | 'unclear'
    error?: AnalysisError['code']
  }
  observed: {
    outcome: 'analyzed' | 'rejected' | 'failed'
    stroke?: ResolvedStroke
    strokeResolution?: 'hypothesis' | 'selected' | 'unknown'
    strokePresentation?: AnalysisResult['strokePresentation']
    requestedStroke?: StrokeType
    timing?: null
    inputQuality?: QualityBand
    poseTrackQuality?: QualityBand
    segmentationReliability?: ReliabilityBand
    landmarkCoverage?: number
    observations?: MeasuredObservation[]
    moments?: KeyMoment[]
    mainObservation?: string
    coachingNote?: string
    drill?: AnalysisResult['drill']
    trace?: AnalysisResult['trace']
    warnings?: string[]
    selectedPlayerId?: 'A' | 'B'
    selectionMethod?: 'auto-near' | 'manual'
    recommendationBand?: ReliabilityBand
    trackingWarnings?: string[]
    segment?: AnalysisResult['segment']
    limitations?: string[]
    error?: { code: string; message: string }
  }
  videoAnalysisRun?: VideoAnalysisRun
  processingDurationMs: number
  verdict: 'pass' | 'warn' | 'fail'
  testerNote: string
  generatedAt: string
}

export class AnalysisError extends Error {
  constructor(
    public readonly code:
      | 'SHORT_VIDEO'
      | 'NO_PERSON'
      | 'MULTIPLE_PEOPLE'
      | 'LOW_VISIBILITY'
      | 'SEGMENTATION_FAILED'
      | 'CORRUPT_VIDEO'
      | 'PROCESSING_ERROR'
      | 'UNSUPPORTED_BROWSER'
      | 'CAMERA_DENIED',
    message: string,
  ) {
    super(message)
    this.name = 'AnalysisError'
  }
}

export interface StrokeAnalyzer {
  readonly id: string
  analyze(input: AnalysisInput): Promise<AnalysisResult>
}
