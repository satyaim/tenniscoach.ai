import { useEffect, useRef, useState } from 'react'
import { containVideoRect } from '../analysis/videoGeometry'
import type { PrecomputedBallTrack } from '../analysis/precomputedBallTrack'
import type { PoseFrame, StrokeSegment } from '../analysis/types'
import { BallOverlay } from './BallOverlay'
import { ShotProgressRail } from './ShotSegments'

const VISIBILITY_THRESHOLD = 0.45
const CONNECTIONS = [
  [11, 12],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
] as const

interface PoseOverlayCanvasProps {
  frame?: PoseFrame
  label: string
  intrinsicWidth: number
  intrinsicHeight: number
  tone?: 'primary' | 'secondary'
  playerLabel?: string
}

export function PoseOverlayCanvas({
  frame,
  label,
  intrinsicWidth,
  intrinsicHeight,
  tone = 'primary',
  playerLabel,
}: PoseOverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const draw = () => {
      const bounds = canvas.getBoundingClientRect()
      const width = Math.max(1, bounds.width)
      const height = Math.max(1, bounds.height)
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const backingWidth = Math.round(width * dpr)
      const backingHeight = Math.round(height * dpr)
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth
        canvas.height = backingHeight
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      const pose = frame?.poses[0]
      if (!pose) return
      const rect = containVideoRect(intrinsicWidth, intrinsicHeight, width, height)
      const color = tone === 'secondary' ? 'rgba(255, 61, 219, 0.92)' : 'rgba(51, 224, 255, 0.92)'
      const limbWidth = Math.max(1, 4 * rect.scale)
      const jointRadius = Math.max(1.25, 4 * rect.scale)
      const eligible = (index: number) =>
        Boolean(pose[index]) && (pose[index].visibility ?? 0) >= VISIBILITY_THRESHOLD
      const point = (index: number) => ({
        x: rect.x + pose[index].x * rect.width,
        y: rect.y + pose[index].y * rect.height,
      })

      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.lineWidth = limbWidth
      context.strokeStyle = color.replace('0.92', '0.68')
      for (const [from, to] of CONNECTIONS) {
        if (!eligible(from) || !eligible(to)) continue
        const start = point(from)
        const end = point(to)
        context.beginPath()
        context.moveTo(start.x, start.y)
        context.lineTo(end.x, end.y)
        context.stroke()
      }

      context.fillStyle = color
      for (const index of new Set(CONNECTIONS.flat())) {
        if (!eligible(index)) continue
        const center = point(index)
        context.beginPath()
        context.arc(center.x, center.y, jointRadius, 0, Math.PI * 2)
        context.fill()
      }

      if (playerLabel) {
        const visiblePoints = [...new Set(CONNECTIONS.flat())].filter(eligible).map(point)
        if (visiblePoints.length) {
          const left = Math.min(...visiblePoints.map(({ x }) => x))
          const top = Math.min(...visiblePoints.map(({ y }) => y))
          const badgeRadius = Math.max(10, 12 * rect.scale)
          const badgeX = Math.max(badgeRadius + 4, left)
          const badgeY = Math.max(badgeRadius + 4, top - badgeRadius * 1.4)
          context.fillStyle = color
          context.beginPath()
          context.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2)
          context.fill()
          context.fillStyle = '#02100d'
          context.font = `700 ${Math.max(12, 14 * rect.scale)}px system-ui, sans-serif`
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.fillText(playerLabel, badgeX, badgeY)
        }
      }
    }

    draw()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(draw)
    observer?.observe(canvas)
    window.addEventListener('resize', draw)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', draw)
    }
  }, [frame, intrinsicHeight, intrinsicWidth, playerLabel, tone])

  return <canvas ref={canvasRef} className="pose-overlay" role="img" aria-label={label} />
}

interface PoseViewerProps {
  frame?: PoseFrame
  secondaryFrame?: PoseFrame
  label: string
  videoUrl: string
  intrinsicWidth: number
  intrinsicHeight: number
  onVideoRef?: (video: HTMLVideoElement | null) => void
  onTimeUpdate?: (timestampMs: number) => void
  primaryPlayerLabel?: string
  secondaryPlayerLabel?: string
  ballTrack?: PrecomputedBallTrack
  showBadge?: boolean
  shotSegments?: StrokeSegment[]
  currentTimeMs?: number
  shotPlayerLabel?: string
}

export function PoseViewer({
  frame,
  secondaryFrame,
  label,
  videoUrl,
  intrinsicWidth,
  intrinsicHeight,
  onVideoRef,
  onTimeUpdate,
  primaryPlayerLabel,
  secondaryPlayerLabel,
  ballTrack,
  showBadge = true,
  shotSegments = [],
  currentTimeMs = 0,
  shotPlayerLabel,
}: PoseViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [presentedTimestampMs, setPresentedTimestampMs] = useState(0)
  const [ballResetToken, setBallResetToken] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (
      !video
      || (!onTimeUpdate && !ballTrack)
      || typeof video.requestVideoFrameCallback !== 'function'
    ) return

    let callbackId: number | undefined
    let cancelled = false
    const updateFromPresentedFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (cancelled) return
      const timestampMs = metadata.mediaTime * 1000
      setPresentedTimestampMs(timestampMs)
      onTimeUpdate?.(timestampMs)
      callbackId = video.requestVideoFrameCallback(updateFromPresentedFrame)
    }

    callbackId = video.requestVideoFrameCallback(updateFromPresentedFrame)
    return () => {
      cancelled = true
      if (callbackId !== undefined) video.cancelVideoFrameCallback(callbackId)
    }
  }, [ballTrack, onTimeUpdate, videoUrl])

  useEffect(() => {
    setPresentedTimestampMs(0)
    setBallResetToken((token) => token + 1)
  }, [videoUrl])

  const selectShot = (segment: StrokeSegment) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = segment.onsetMs / 1000
    setBallResetToken((token) => token + 1)
    setPresentedTimestampMs(segment.onsetMs)
    onTimeUpdate?.(segment.onsetMs)
  }

  return (
    <div
      className="pose-viewer"
      aria-label={`Pose visualization: ${label}`}
      style={{ aspectRatio: intrinsicWidth / intrinsicHeight }}
    >
      <video
        ref={(video) => {
          videoRef.current = video
          onVideoRef?.(video)
        }}
        className="source-video"
        src={videoUrl}
        controls
        muted
        playsInline
        aria-label="Analyzed tennis video"
        onTimeUpdate={(event) => {
          const timestampMs = event.currentTarget.currentTime * 1000
          setPresentedTimestampMs(timestampMs)
          onTimeUpdate?.(timestampMs)
        }}
        onSeeked={(event) => {
          const timestampMs = event.currentTarget.currentTime * 1000
          setBallResetToken((token) => token + 1)
          setPresentedTimestampMs(timestampMs)
          onTimeUpdate?.(timestampMs)
        }}
      />
      <PoseOverlayCanvas
        frame={frame}
        label={primaryPlayerLabel ? `Player ${primaryPlayerLabel} pose overlay` : label}
        intrinsicWidth={intrinsicWidth}
        intrinsicHeight={intrinsicHeight}
        playerLabel={primaryPlayerLabel}
      />
      {secondaryFrame && (
        <PoseOverlayCanvas
          frame={secondaryFrame}
          label={`Player ${secondaryPlayerLabel ?? 'B'} pose overlay`}
          intrinsicWidth={intrinsicWidth}
          intrinsicHeight={intrinsicHeight}
          tone="secondary"
          playerLabel={secondaryPlayerLabel}
        />
      )}
      {ballTrack && (
        <BallOverlay
          track={ballTrack}
          timestampMs={presentedTimestampMs}
          resetToken={ballResetToken}
        />
      )}
      <ShotProgressRail
        segments={shotSegments}
        durationMs={Math.max(1, videoRef.current?.duration
          ? videoRef.current.duration * 1000
          : ballTrack?.timeline.durationMs ?? 1)}
        currentTimeMs={currentTimeMs}
        onSelect={selectShot}
        playerLabel={shotPlayerLabel}
      />
      {showBadge && (
        <div className="viewer-badge">
          <span className="live-dot" />
          {label}
        </div>
      )}
    </div>
  )
}
