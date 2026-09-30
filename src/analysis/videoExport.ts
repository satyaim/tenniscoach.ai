import {
  renderCompositeFrame,
  type CompositeOverlayInput,
} from './compositeRenderer'
import { resetBallTrail } from './ballOverlayModel'
import { chooseWebmMimeType } from './overlayModel'

type CapturableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}

export const canExportCombinedVideo = () =>
  typeof HTMLCanvasElement !== 'undefined'
  && typeof HTMLCanvasElement.prototype.captureStream === 'function'
  && typeof MediaRecorder !== 'undefined'
  && Boolean(chooseWebmMimeType(MediaRecorder.isTypeSupported?.bind(MediaRecorder)))

export const composeExportStream = (
  canvasStream: MediaStream,
  sourceAudioStream?: MediaStream,
) => new MediaStream([
  ...canvasStream.getVideoTracks(),
  ...(sourceAudioStream?.getAudioTracks() ?? []),
])

const sourceAudioStream = (
  video: CapturableVideo,
): { stream?: MediaStream; cleanup: () => void } => {
  const captured = video.captureStream?.() ?? video.mozCaptureStream?.()
  if (captured?.getAudioTracks().length) {
    return { stream: captured, cleanup: () => captured.getTracks().forEach((track) => track.stop()) }
  }
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) return { cleanup: () => undefined }
  const audioContext = new AudioContextClass()
  const source = audioContext.createMediaElementSource(video)
  const destination = audioContext.createMediaStreamDestination()
  source.connect(destination)
  return {
    stream: destination.stream,
    cleanup: () => {
      source.disconnect()
      destination.disconnect()
      void audioContext.close()
    },
  }
}

const waitForEvent = (target: EventTarget, name: string, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const completed = () => {
      cleanup()
      resolve()
    }
    const cancelled = () => {
      cleanup()
      reject(new DOMException('Export cancelled.', 'AbortError'))
    }
    const cleanup = () => {
      target.removeEventListener(name, completed)
      signal.removeEventListener('abort', cancelled)
    }
    target.addEventListener(name, completed, { once: true })
    signal.addEventListener('abort', cancelled, { once: true })
  })

export const exportCombinedVideo = async ({
  video,
  canvas,
  overlay,
  fps,
  signal,
  onProgress,
}: {
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  overlay: Omit<CompositeOverlayInput, 'timestampMs'>
  fps: number
  signal: AbortSignal
  onProgress: (progress: number) => void
}) => {
  if (!canExportCombinedVideo()) {
    throw new Error('Annotated WebM export requires current Chrome or Edge.')
  }
  const mimeType = chooseWebmMimeType(MediaRecorder.isTypeSupported.bind(MediaRecorder))
  if (!mimeType) throw new Error('No compatible WebM encoder is available.')
  canvas.width = overlay.sourceWidth
  canvas.height = overlay.sourceHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The export canvas could not be initialized.')
  video.currentTime = 0
  if (video.readyState < 2) await waitForEvent(video, 'loadeddata', signal)
  else if (video.currentTime !== 0) await waitForEvent(video, 'seeked', signal)

  const canvasStream = canvas.captureStream(Math.min(60, Math.max(12, fps)))
  const audio = sourceAudioStream(video as CapturableVideo)
  const stream = composeExportStream(canvasStream, audio.stream)
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.max(3_000_000, overlay.sourceWidth * overlay.sourceHeight * 5),
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }
  const completed = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('MediaRecorder failed while exporting.'))
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
  })
  let trail = resetBallTrail()
  let animation = 0
  const draw = () => {
    trail = renderCompositeFrame(context, video, {
      ...overlay,
      timestampMs: video.currentTime * 1000,
    }, trail)
    onProgress(Math.min(1, video.currentTime / Math.max(0.001, video.duration)))
    if (!video.ended && !signal.aborted) animation = requestAnimationFrame(draw)
  }
  try {
    recorder.start(250)
    animation = requestAnimationFrame(draw)
    video.volume = 0
    await video.play()
    await Promise.race([
      waitForEvent(video, 'ended', signal),
      new Promise<never>((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Export cancelled.', 'AbortError')),
          { once: true },
        )
      }),
    ])
    recorder.stop()
    const blob = await completed
    onProgress(1)
    return { blob, mimeType }
  } finally {
    cancelAnimationFrame(animation)
    video.pause()
    if (recorder.state !== 'inactive') recorder.stop()
    stream.getTracks().forEach((track) => track.stop())
    audio.cleanup()
  }
}
