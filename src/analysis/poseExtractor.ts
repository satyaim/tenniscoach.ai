import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { AnalysisError, type PoseFrame } from './types'

export const POSE_MODEL_MANIFEST = {
  runtimeId: '@mediapipe/tasks-vision',
  runtimeVersion: '1.0.1',
  runtimeLicense: 'Apache-2.0',
  wasmRoot: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  modelId: 'pose_landmarker_lite',
  modelVersion: 'float16/1',
  modelLicense: 'Apache-2.0',
  modelUrl: '/models/pose_landmarker_lite-float16-v1.task',
  checkpointHash: 'sha256:59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  provenance: 'Google MediaPipe Pose Landmarker Lite, derived from BlazePose GHUM.',
  trainingProvenance: 'The public model documentation does not disclose a complete training-data inventory.',
} as const

const abortError = () => new DOMException('Analysis cancelled.', 'AbortError')

const throwIfCancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError()
}

type PoseLandmarkerInstance = Awaited<ReturnType<typeof PoseLandmarker.createFromOptions>>

export const loadVerifiedPoseModel = async (signal?: AbortSignal) => {
  throwIfCancelled(signal)
  const response = await fetch(POSE_MODEL_MANIFEST.modelUrl, { signal })
  if (!response.ok) throw new Error(`Pose model download failed (${response.status}).`)
  const buffer = await response.arrayBuffer()
  throwIfCancelled(signal)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  throwIfCancelled(signal)
  const actual = `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')}`
  if (actual !== POSE_MODEL_MANIFEST.checkpointHash) {
    throw new Error('Pose model integrity verification failed.')
  }
  return buffer
}

interface PoseLandmarkerDependencies {
  loadModel(signal?: AbortSignal): Promise<ArrayBuffer>
  resolveVision(): ReturnType<typeof FilesetResolver.forVisionTasks>
  create(
    vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    options: Parameters<typeof PoseLandmarker.createFromOptions>[1],
  ): Promise<PoseLandmarkerInstance>
}

const defaultDependencies: PoseLandmarkerDependencies = {
  loadModel: loadVerifiedPoseModel,
  resolveVision: () => FilesetResolver.forVisionTasks(POSE_MODEL_MANIFEST.wasmRoot),
  create: (vision, options) => PoseLandmarker.createFromOptions(vision, options),
}

export const createPoseLandmarker = async (
  signal?: AbortSignal,
  forceCpu = false,
  dependencies: PoseLandmarkerDependencies = defaultDependencies,
) => {
  const modelBuffer = await dependencies.loadModel(signal)
  const delegates = forceCpu ? ['CPU'] as const : ['GPU', 'CPU'] as const
  let lastError: unknown
  for (const delegate of delegates) {
    throwIfCancelled(signal)
    const vision = await dependencies.resolveVision()
    throwIfCancelled(signal)
    try {
      const landmarker = await dependencies.create(vision, {
        baseOptions: {
          modelAssetBuffer: new Uint8Array(modelBuffer.slice(0)),
          delegate,
        },
        runningMode: 'VIDEO',
        numPoses: 2,
        minPoseDetectionConfidence: 0.45,
        minPosePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      })
      if (signal?.aborted) {
        landmarker.close()
        throw abortError()
      }
      return landmarker
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortError()
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The pose runtime could not initialize.')
}

const resultToFrame = (result: ReturnType<PoseLandmarker['detectForVideo']>, timestampMs: number) => ({
  timestampMs,
  poses: result.landmarks.map((pose) =>
    pose.map((landmark) => ({
      x: landmark.x,
      y: landmark.y,
      z: landmark.z,
      visibility: landmark.visibility,
    })),
  ),
})

export interface LivePoseSession {
  detect(video: HTMLVideoElement, timestampMs: number): PoseFrame
  close(): void
}

export const createLivePoseSession = async (): Promise<LivePoseSession> => {
  if (!('WebAssembly' in window)) {
    throw new AnalysisError('UNSUPPORTED_BROWSER', 'This browser cannot run local pose analysis.')
  }
  const landmarker = await createPoseLandmarker()
  let lastTimestamp = -1
  return {
    detect(video, timestampMs) {
      const monotonicTimestamp = Math.max(timestampMs, lastTimestamp + 1)
      lastTimestamp = monotonicTimestamp
      return resultToFrame(landmarker.detectForVideo(video, monotonicTimestamp), monotonicTimestamp)
    },
    close() {
      landmarker.close()
    },
  }
}

export const seekVideo = (video: HTMLVideoElement, time: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const done = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new AnalysisError('CORRUPT_VIDEO', 'The video could not be decoded. Try MP4, WebM, or MOV.'))
    }
    const cancelled = () => {
      cleanup()
      reject(abortError())
    }
    const cleanup = () => {
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', failed)
      signal?.removeEventListener('abort', cancelled)
    }
    video.addEventListener('seeked', done, { once: true })
    video.addEventListener('error', failed, { once: true })
    signal?.addEventListener('abort', cancelled, { once: true })
    video.currentTime = time
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) queueMicrotask(done)
  })

export const extractPoseFrames = async (
  video: HTMLVideoElement,
  onProgress: (progress: number) => void,
  windowSeconds?: { start: number; end: number },
  onBatch?: (frames: PoseFrame[]) => void | Promise<void>,
  sourceFps?: number,
  signal?: AbortSignal,
): Promise<PoseFrame[]> => {
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new DOMException('Analysis cancelled.', 'AbortError')
  }
  throwIfCancelled()
  if (!('WebAssembly' in window)) {
    throw new AnalysisError('UNSUPPORTED_BROWSER', 'This browser cannot run local pose analysis.')
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new AnalysisError('CORRUPT_VIDEO', 'The video duration could not be read.')
  }
  const start = Math.max(0, windowSeconds?.start ?? 0)
  const end = Math.min(video.duration, windowSeconds?.end ?? video.duration)
  const analysisDuration = end - start
  if (analysisDuration < 1.5) {
    throw new AnalysisError('SHORT_VIDEO', 'Use a clip at least 1.5 seconds long.')
  }

  const forceCpu =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('poseDelegate') === 'cpu'
  const landmarker = await createPoseLandmarker(signal, forceCpu)
  throwIfCancelled()
  try {
    const targetFps = Math.min(30, sourceFps ?? 16)
    const sampleCount = Math.min(180, Math.max(24, Math.ceil(analysisDuration * targetFps) + 1))
    const frames: PoseFrame[] = []
    for (let index = 0; index < sampleCount; index += 1) {
      throwIfCancelled()
      const time = start + (index / Math.max(1, sampleCount - 1)) * Math.max(0, analysisDuration - 0.02)
      await seekVideo(video, time, signal)
      throwIfCancelled()
      const timestampMs = Math.round(time * 1000)
      const result = landmarker.detectForVideo(video, timestampMs)
      frames.push(resultToFrame(result, timestampMs))
      onProgress((index + 1) / sampleCount)
      if (onBatch && ((index + 1) % 12 === 0 || index === sampleCount - 1)) {
        await onBatch([...frames])
        throwIfCancelled()
      }
      if ((index + 1) % 6 === 0) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    }
    return frames
  } catch (error) {
    if (error instanceof AnalysisError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new AnalysisError(
      'PROCESSING_ERROR',
      'The local pose engine could not process this clip. Retry once; if it persists, reload the page or use another clip.',
    )
  } finally {
    landmarker.close()
  }
}
