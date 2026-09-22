import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Pause, Play } from 'lucide-react'
import { canExportAnnotatedVideo, chooseWebmMimeType, overlayAtTime } from '../analysis/overlayModel'
import type { AnalysisResult, PoseFrame, StrokeSegment } from '../analysis/types'

const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23],
  [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
]

const fitRect = (sourceWidth: number, sourceHeight: number, width: number, height: number) => {
  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  return {
    x: (width - sourceWidth * scale) / 2,
    y: (height - sourceHeight * scale) / 2,
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  }
}

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
  context.fill()
}

const drawAnnotatedFrame = (
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  frames: PoseFrame[],
  result: AnalysisResult,
  timestampMs: number,
) => {
  const { width, height } = context.canvas
  context.fillStyle = '#07100d'
  context.fillRect(0, 0, width, height)
  const sourceWidth = video.videoWidth || width
  const sourceHeight = video.videoHeight || height
  const rect = fitRect(sourceWidth, sourceHeight, width, height)
  context.drawImage(video, rect.x, rect.y, rect.width, rect.height)

  const overlay = overlayAtTime(frames, result, timestampMs)
  const pose = overlay.frame?.poses[0]
  if (pose) {
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = overlay.isUncertain ? 'rgba(255,197,103,.7)' : 'rgba(224,255,147,.9)'
    context.lineWidth = Math.max(2, width / 420)
    for (const [from, to] of CONNECTIONS) {
      if (!pose[from] || !pose[to]) continue
      context.beginPath()
      context.moveTo(rect.x + pose[from].x * rect.width, rect.y + pose[from].y * rect.height)
      context.lineTo(rect.x + pose[to].x * rect.width, rect.y + pose[to].y * rect.height)
      context.stroke()
    }
    context.fillStyle = overlay.isUncertain ? '#ffc567' : '#c9ff45'
    for (const index of new Set(CONNECTIONS.flat())) {
      const point = pose[index]
      if (!point) continue
      context.beginPath()
      context.arc(
        rect.x + point.x * rect.width,
        rect.y + point.y * rect.height,
        index === 15 || index === 16 ? width / 180 : width / 250,
        0,
        Math.PI * 2,
      )
      context.fill()
    }
  }

  const padding = width * 0.025
  context.fillStyle = 'rgba(7,18,14,.82)'
  roundedRect(context, padding, padding, width * 0.43, height * 0.13, 14)
  context.fillStyle = overlay.isUncertain ? '#ffc567' : '#c9ff45'
  context.font = `700 ${Math.max(14, width / 45)}px Inter, Segoe UI, sans-serif`
  context.fillText(overlay.phase.toUpperCase(), padding * 1.55, padding * 2.1)
  context.fillStyle = '#eaf2ed'
  context.font = `600 ${Math.max(11, width / 64)}px Inter, Segoe UI, sans-serif`
  context.fillText(
    `${result.strokePresentation.label.toUpperCase()} · ${result.strokePresentation.provenance.toUpperCase()} · ${result.poseTrackQuality.toUpperCase()} POSE TRACK · ${result.segmentationReliability.toUpperCase()} SEGMENT`,
    padding * 1.55,
    padding * 3.15,
  )

  context.fillStyle = 'rgba(7,18,14,.84)'
  roundedRect(context, padding, height - height * 0.17 - padding, width - padding * 2, height * 0.17, 14)
  context.fillStyle = '#f2f7f4'
  context.font = `600 ${Math.max(12, width / 52)}px Inter, Segoe UI, sans-serif`
  const cue = overlay.cue.length > 92 ? `${overlay.cue.slice(0, 89)}…` : overlay.cue
  context.fillText(cue, padding * 1.55, height - padding * 2.4, width - padding * 3)
  context.fillStyle = '#9fb0a8'
  context.font = `500 ${Math.max(10, width / 72)}px Inter, Segoe UI, sans-serif`
  context.fillText('Local 2D pose evidence · ball contact and timing are not observed', padding * 1.55, height - padding * 1.35)
}

interface AnnotatedReplayProps {
  videoUrl: string
  frames: PoseFrame[]
  result: AnalysisResult
  segments: StrokeSegment[]
  chapterResults: AnalysisResult[]
  onFrameChange: (index: number) => void
  onSegmentSelect: (segmentId: string) => void
  onAddMarker: (timestampMs: number) => void
  onAdjustMarker: (segmentId: string, timestampMs: number) => void
  seekTimestampMs?: number
}

export function AnnotatedReplay({
  videoUrl,
  frames,
  result,
  segments,
  chapterResults,
  onFrameChange,
  onSegmentSelect,
  onAddMarker,
  onAdjustMarker,
  seekTimestampMs,
}: AnnotatedReplayProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | undefined>(undefined)
  const activeSegmentRef = useRef(result.segment.id)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(frames[0]?.timestampMs ?? 0)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string>()
  const startMs = frames[0]?.timestampMs ?? 0
  const endMs = frames.at(-1)?.timestampMs ?? startMs
  const exportSupported = useMemo(() => canExportAnnotatedVideo(), [])

  useEffect(() => {
    activeSegmentRef.current = result.segment.id
  }, [result.segment.id])

  useEffect(() => {
    if (videoRef.current && seekTimestampMs !== undefined) {
      videoRef.current.currentTime = seekTimestampMs / 1000
      setCurrentTimeMs(seekTimestampMs)
    }
  }, [seekTimestampMs])

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const draw = () => {
      const timestampMs = video.currentTime * 1000
      drawAnnotatedFrame(context, video, frames, result, timestampMs)
      setCurrentTimeMs(timestampMs)
      const active = segments.find((segment) => timestampMs >= segment.startMs && timestampMs <= segment.endMs)
      if (active && active.id !== activeSegmentRef.current) {
        activeSegmentRef.current = active.id
        onSegmentSelect(active.id)
      }
      onFrameChange(
        frames.reduce(
          (best, frame, index) =>
            Math.abs(frame.timestampMs - timestampMs) < Math.abs(frames[best].timestampMs - timestampMs)
              ? index
              : best,
          0,
        ),
      )
      if (video.currentTime * 1000 >= endMs && !video.paused) {
        video.pause()
        setIsPlaying(false)
      }
      animationRef.current = requestAnimationFrame(draw)
    }
    animationRef.current = requestAnimationFrame(draw)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [endMs, frames, onFrameChange, onSegmentSelect, result, segments])

  const togglePlayback = async () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      if (video.currentTime * 1000 >= endMs - 30) video.currentTime = startMs / 1000
      await video.play()
      setIsPlaying(true)
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }

  const scrub = (timestampMs: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = timestampMs / 1000
    setCurrentTimeMs(timestampMs)
  }

  const exportVideo = async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !exportSupported) {
      setExportError('Annotated WebM export is not supported in this browser. Use current Chrome or Edge.')
      return
    }
    const mimeType = chooseWebmMimeType(MediaRecorder.isTypeSupported.bind(MediaRecorder))
    if (!mimeType) {
      setExportError('This browser does not provide a compatible WebM recorder.')
      return
    }
    setExportError(undefined)
    setIsExporting(true)
    const previousTime = video.currentTime
    const wasPaused = video.paused
    try {
      video.pause()
      video.currentTime = startMs / 1000
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) resolve()
        else video.addEventListener('seeked', () => resolve(), { once: true })
      })
      const stream = canvas.captureStream(30)
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 })
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      const completed = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error('MediaRecorder failed while exporting.'))
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
      })
      recorder.start(250)
      await video.play()
      await new Promise<void>((resolve) => {
        const watch = () => {
          if (video.currentTime * 1000 >= endMs || video.ended) resolve()
          else requestAnimationFrame(watch)
        }
        watch()
      })
      video.pause()
      recorder.stop()
      const blob = await completed
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `baseline-${result.stroke}-annotated.webm`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setExportError('The annotated video could not be exported. The source remains private and unchanged.')
    } finally {
      video.currentTime = previousTime
      if (!wasPaused) void video.play()
      setIsExporting(false)
    }
  }

  return (
    <section className="annotated-replay" aria-label="Annotated replay">
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        playsInline
        preload="auto"
        className="replay-source"
        onLoadedData={(event) => {
          event.currentTarget.currentTime = startMs / 1000
          setCurrentTimeMs(startMs)
        }}
      />
      <canvas ref={canvasRef} width="1280" height="720" aria-label="Video with pose and coaching overlays" />
      <div className="replay-controls">
        <button className="icon-button" onClick={() => void togglePlayback()} aria-label={isPlaying ? 'Pause annotated replay' : 'Play annotated replay'}>
          {isPlaying ? <Pause /> : <Play />}
        </button>
        <div className="unified-timeline">
          <div className="segment-track" aria-label="Stroke candidates with context ranges">
            {segments.map((segment) => {
              const chapterIndex = segments.findIndex((item) => item.id === segment.id)
              const chapter = chapterResults.find((item) => item.segment.id === segment.id)
              const total = Math.max(1, endMs - startMs)
              const left = ((segment.startMs - startMs) / total) * 100
              const width = ((segment.endMs - segment.startMs) / total) * 100
              const activeLeft = ((segment.onsetMs - segment.startMs) / Math.max(1, segment.endMs - segment.startMs)) * 100
              const activeWidth = ((segment.offsetMs - segment.onsetMs) / Math.max(1, segment.endMs - segment.startMs)) * 100
              return (
                <button
                  key={segment.id}
                  className={[
                    'segment-range',
                    segment.status === 'provisional' ? 'segment-range--provisional' : '',
                    segment.id === result.segment.id ? 'segment-range--selected' : '',
                  ].filter(Boolean).join(' ')}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 1.5)}%`,
                    zIndex: segment.id === result.segment.id ? segments.length + 2 : segments.length - chapterIndex,
                  }}
                  onClick={() => {
                    onSegmentSelect(segment.id)
                    scrub(segment.startMs)
                  }}
                  aria-label={`Movement chapter ${chapterIndex + 1}: ${chapter?.strokePresentation.label ?? 'pending'}, ${segment.poseEvidence} pose evidence, ${Math.round(segment.startMs)} to ${Math.round(segment.endMs)} milliseconds`}
                >
                  <span style={{ left: `${activeLeft}%`, width: `${Math.max(activeWidth, 5)}%` }} />
                  <strong style={{ left: `${((segment.peakMs - segment.startMs) / Math.max(1, segment.endMs - segment.startMs)) * 100}%` }} />
                  <em>S{chapterIndex + 1}</em>
                </button>
              )
            })}
            <i style={{ left: `${((currentTimeMs - startMs) / Math.max(1, endMs - startMs)) * 100}%` }} />
          </div>
          <input
            type="range"
            min={startMs}
            max={endMs}
            value={Math.min(endMs, Math.max(startMs, currentTimeMs))}
            onChange={(event) => scrub(Number(event.target.value))}
            aria-label="Scrub annotated replay"
          />
          <small>Dim = pre/post context · bright = active movement · line = playhead</small>
        </div>
        <span>{((currentTimeMs - startMs) / 1000).toFixed(1)}s</span>
      </div>
      <div className="replay-export">
        <button className="button button--secondary" onClick={() => onAddMarker(currentTimeMs)}>
          Add review marker here
        </button>
        <button className="button button--secondary" onClick={() => onAdjustMarker(result.segment.id, currentTimeMs)}>
          Move selected marker here
        </button>
        <button className="button button--secondary" onClick={() => void exportVideo()} disabled={isExporting}>
          <Download size={18} /> {isExporting ? 'Exporting in real time…' : 'Export annotated video (.webm)'}
        </button>
        <small>Explicit download only. Video stays in this browser; audio is omitted.</small>
      </div>
      {!exportSupported && <p className="inline-warning">WebM export requires canvas capture and MediaRecorder support in current Chrome or Edge.</p>}
      {exportError && <p className="inline-error" role="alert">{exportError}</p>}
    </section>
  )
}
