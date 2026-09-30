import { analysisCache, sha256Blob, type CacheReadStatus, type StageCacheIdentity } from './analysisCache'
import { heuristicAnalyzer } from './heuristicAnalyzer'
import { extractPoseFrames, POSE_MODEL_MANIFEST } from './poseExtractor'
import {
  filterFramesForTrack,
  trackPlayers,
  type PlayerTrack,
  type PlayerTrackingResult,
} from './playerTracker'
import { segmentStrokes } from './strokeSegmenter'
import { AnalysisError, type AnalysisResult, type PoseFrame, type StrokeSegment } from './types'

export interface VideoSourceMetadata {
  durationMs: number
  width: number
  height: number
}

export interface VideoAnalysisProgress {
  stage: 'preparing' | 'loading-model' | 'analyzing' | 'finalizing'
  value: number
  message: string
}

interface VideoAnalysisBase {
  source: VideoSourceMetadata
  sourceHash: string
  frames: PoseFrame[]
  tracking: PlayerTrackingResult
  cacheStatus: CacheReadStatus
}

export interface CompletedVideoAnalysisOutput extends VideoAnalysisBase {
  status: 'ready'
  filteredFrames: PoseFrame[]
  selectedPlayerId: PlayerTrack['id']
  segments: StrokeSegment[]
  result: AnalysisResult
}

export type VideoAnalysisOutput = CompletedVideoAnalysisOutput

interface RunOptions {
  file: File
  video: HTMLVideoElement
  signal: AbortSignal
  sourceHash?: string
  onProgress: (progress: VideoAnalysisProgress) => void
  onBatch?: (frames: PoseFrame[]) => void
}

const poseIdentity = (sourceVideoSha256: string): StageCacheIdentity => ({
  sourceVideoSha256,
  stageId: 'player-pose',
  implementationVersion: 'pose-extractor.v2',
  providerId: 'mediapipe-pose-landmarker',
  providerVersion: '1',
  modelId: POSE_MODEL_MANIFEST.modelId,
  modelVersion: POSE_MODEL_MANIFEST.modelVersion,
  runtimeId: POSE_MODEL_MANIFEST.runtimeId,
  runtimeVersion: POSE_MODEL_MANIFEST.runtimeVersion,
  checkpointHash: POSE_MODEL_MANIFEST.checkpointHash,
  preprocessingConfigHash: 'sha256:video-seek-6fps-cap180-two-poses-v5',
  contractVersion: 'pose-frame.v1',
  decoderTimelineVersion: 'html-video-seek.v1',
  upstreamArtifactHashes: [],
  dependencyArtifactHashes: [],
})

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export const isPoseFrameArtifact = (value: unknown): value is PoseFrame[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((frame) =>
    Boolean(frame) &&
    typeof frame === 'object' &&
    isFiniteNumber((frame as PoseFrame).timestampMs) &&
    Array.isArray((frame as PoseFrame).poses) &&
    (frame as PoseFrame).poses.every((pose) =>
      Array.isArray(pose) &&
      pose.every((point) =>
        isFiniteNumber(point.x) &&
        isFiniteNumber(point.y) &&
        (point.z === undefined || isFiniteNumber(point.z)) &&
        (point.visibility === undefined || isFiniteNumber(point.visibility))),
    ),
  )

const reliabilityForSelection = (
  value: number,
): NonNullable<AnalysisResult['playerSelection']>['recommendationBand'] =>
  value >= 0.8 ? 'high' : value >= 0.6 ? 'medium' : value >= 0.4 ? 'low' : 'insufficient'

export const analyzePoseFrames = async (
  frames: PoseFrame[],
  source: VideoSourceMetadata,
): Promise<Omit<CompletedVideoAnalysisOutput, 'sourceHash' | 'cacheStatus'>> => {
  const tracking = trackPlayers(frames)
  const selectedTrack =
    tracking.tracks.find((track) => track.id === tracking.recommendedPlayerId) ??
    tracking.tracks[0]
  if (!selectedTrack) {
    throw new AnalysisError('NO_PERSON', 'No full player pose was visible often enough to analyze.')
  }

  const filteredFrames = filterFramesForTrack(frames, selectedTrack)
  const segments = segmentStrokes(filteredFrames, 'auto')
  const segment = segments.find((candidate) => candidate.status === 'final') ?? segments[0]
  if (!segment) {
    throw new AnalysisError('SEGMENTATION_FAILED', 'No reviewable movement range was found.')
  }

  const result = await heuristicAnalyzer.analyze({
    frames: filteredFrames,
    durationMs: source.durationMs,
    handedness: 'unknown',
    requestedStroke: 'auto',
    allowStrokeHypothesis: false,
    source: 'upload',
    coachingMode: 'observations-only',
    captureContext: {
      viewpoint: 'uploaded monocular video',
      cameraMotion: 'unknown',
      cuts: 'unknown',
      resolution: `${source.width}x${source.height}`,
      sourceFps: 6,
      samplingConfig: 'mediapipe-lite-6fps-cap180-v5',
      normalizationGeometry: 'shoulder-width-2d-v1',
    },
    segment,
  })
  result.playerSelection = {
    selectedPlayerId: selectedTrack.id,
    selectionMethod: 'auto-near',
    recommendationBand: reliabilityForSelection(tracking.selectionConfidence),
    trackingWarnings: tracking.warnings,
  }

  return {
    status: 'ready',
    source,
    frames,
    filteredFrames,
    tracking,
    selectedPlayerId: selectedTrack.id,
    segments,
    result,
  }
}

export const runVideoAnalysis = async ({
  file,
  video,
  signal,
  sourceHash: providedSourceHash,
  onProgress,
  onBatch,
}: RunOptions): Promise<VideoAnalysisOutput> => {
  const source: VideoSourceMetadata = {
    durationMs: Math.round(video.duration * 1000),
    width: video.videoWidth,
    height: video.videoHeight,
  }
  onProgress({ stage: 'preparing', value: 0.03, message: 'Preparing your private local video…' })
  const sourceHash = providedSourceHash ?? await sha256Blob(file, signal)
  if (signal.aborted) throw new DOMException('Analysis cancelled.', 'AbortError')

  const identity = poseIdentity(sourceHash)
  const cached = await analysisCache.read(identity, isPoseFrameArtifact)
  let frames: PoseFrame[]
  if (cached.status === 'hit' && cached.artifact) {
    frames = cached.artifact.payload
    onBatch?.(frames)
    onProgress({ stage: 'finalizing', value: 0.9, message: 'Reusing pose analysis stored in this browser…' })
  } else {
    onProgress({ stage: 'loading-model', value: 0.08, message: 'Loading the pose model…' })
    frames = await extractPoseFrames(
      video,
      (value) => onProgress({
        stage: 'analyzing',
        value: 0.1 + value * 0.78,
        message: `Analyzing body position… ${Math.round(value * 100)}%`,
      }),
      undefined,
      async (batch) => onBatch?.(batch),
      6,
      signal,
    )
    await analysisCache.write(identity, frames, isPoseFrameArtifact, signal).catch(() => undefined)
  }

  if (signal.aborted) throw new DOMException('Analysis cancelled.', 'AbortError')
  onProgress({ stage: 'finalizing', value: 0.92, message: 'Preparing your tennis feedback…' })
  const analyzed = await analyzePoseFrames(frames, source)
  onProgress({ stage: 'finalizing', value: 1, message: 'Analysis ready.' })
  return { ...analyzed, sourceHash, cacheStatus: cached.status }
}
