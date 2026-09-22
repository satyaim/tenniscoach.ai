import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { AnalysisError, type PoseFrame } from './types'

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

const createLandmarker = async () => {
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
  try {
    return await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 2,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    })
  } catch {
    const cpuVision = await FilesetResolver.forVisionTasks(WASM_ROOT)
    return PoseLandmarker.createFromOptions(cpuVision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numPoses: 2,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    })
  }
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
  const landmarker = await createLandmarker()
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

const seek = (video: HTMLVideoElement, time: number) =>
  new Promise<void>((resolve, reject) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', failed)
      resolve()
    }
    const failed = () => {
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', failed)
      reject(new AnalysisError('CORRUPT_VIDEO', 'The video could not be decoded. Try MP4, WebM, or MOV.'))
    }
    video.addEventListener('seeked', done, { once: true })
    video.addEventListener('error', failed, { once: true })
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

  const landmarker = await createLandmarker()
  try {
    const targetFps = Math.min(30, sourceFps ?? 16)
    const sampleCount = Math.min(320, Math.max(26, Math.ceil(analysisDuration * targetFps) + 1))
    const frames: PoseFrame[] = []
    for (let index = 0; index < sampleCount; index += 1) {
      throwIfCancelled()
      const time = start + (index / Math.max(1, sampleCount - 1)) * Math.max(0, analysisDuration - 0.02)
      await seek(video, time)
      throwIfCancelled()
      const timestampMs = Math.round(time * 1000)
      const result = landmarker.detectForVideo(video, timestampMs)
      frames.push(resultToFrame(result, timestampMs))
      onProgress((index + 1) / sampleCount)
      if (onBatch && ((index + 1) % 12 === 0 || index === sampleCount - 1)) {
        await onBatch([...frames])
        throwIfCancelled()
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
