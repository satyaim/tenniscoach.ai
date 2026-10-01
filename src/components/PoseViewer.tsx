import { useEffect, useRef, useState } from 'react'
import { ballTrailTrackIdentity, resetBallTrail } from '../analysis/ballOverlayModel'
import {
  DEFAULT_COMPOSITE_RENDER_SETTINGS,
  renderCompositeOverlay,
  type CompositeRenderSettings,
  type OverlayToggles,
} from '../analysis/compositeRenderer'
import type { PrecomputedBallTrack } from '../analysis/precomputedBallTrack'
import type { PoseFrame, StrokeSegment } from '../analysis/types'
import { ShotProgressRail } from './ShotSegments'
import { videoStageStyle } from './videoStage'

interface PoseViewerProps {
  frame?: PoseFrame
  frames?: PoseFrame[]
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
  onShotSelect?: (segment: StrokeSegment) => void
  toggles?: OverlayToggles
  renderSettings?: CompositeRenderSettings
}

const defaultToggles: OverlayToggles = {
  body: true,
  ball: true,
}

export function PoseViewer({
  frame,
  frames,
  label,
  videoUrl,
  intrinsicWidth,
  intrinsicHeight,
  onVideoRef,
  onTimeUpdate,
  primaryPlayerLabel,
  ballTrack,
  showBadge = true,
  shotSegments = [],
  currentTimeMs = 0,
  shotPlayerLabel,
  onShotSelect,
  toggles = defaultToggles,
  renderSettings = DEFAULT_COMPOSITE_RENDER_SETTINGS,
}: PoseViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trailRef = useRef(resetBallTrail())
  const [presentedTimestampMs, setPresentedTimestampMs] = useState(0)

  const ballTrackIdentity = ballTrailTrackIdentity(ballTrack)

  useEffect(() => {
    trailRef.current = resetBallTrail()
    setPresentedTimestampMs(0)
  }, [videoUrl, ballTrackIdentity])

  useEffect(() => {
    const video = videoRef.current
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return
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
  }, [onTimeUpdate, videoUrl])

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
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(1, 0, 0, 1, 0, 0)
      const renderFrames = frames?.length ? frames : frame ? [frame] : undefined
      trailRef.current = renderCompositeOverlay(context, {
        timestampMs: presentedTimestampMs,
        sourceWidth: intrinsicWidth,
        sourceHeight: intrinsicHeight,
        poseFrames: renderFrames,
        ballTrack,
        toggles,
        settings: renderSettings,
        playerLabel: primaryPlayerLabel,
      }, trailRef.current)
    }
    draw()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(draw)
    observer?.observe(canvas)
    window.addEventListener('resize', draw)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', draw)
    }
  }, [
    ballTrack,
    frame,
    frames,
    intrinsicHeight,
    intrinsicWidth,
    presentedTimestampMs,
    primaryPlayerLabel,
    renderSettings,
    toggles,
  ])

  const selectShot = (segment: StrokeSegment) => {
    if (onShotSelect) {
      onShotSelect(segment)
      return
    }
    const video = videoRef.current
    if (!video) return
    video.currentTime = segment.onsetMs / 1000
    trailRef.current = resetBallTrail()
    setPresentedTimestampMs(segment.onsetMs)
    onTimeUpdate?.(segment.onsetMs)
  }

  return (
    <div
      className="pose-viewer"
      aria-label={`Pose visualization: ${label}`}
      style={videoStageStyle(intrinsicWidth / intrinsicHeight)}
    >
      <video
        ref={(video) => {
          videoRef.current = video
          onVideoRef?.(video)
        }}
        className="source-video"
        src={videoUrl}
        controls
        playsInline
        preload="auto"
        aria-label="Analyzed tennis video"
        onTimeUpdate={(event) => {
          const timestampMs = event.currentTarget.currentTime * 1000
          setPresentedTimestampMs(timestampMs)
          onTimeUpdate?.(timestampMs)
        }}
        onSeeked={(event) => {
          const timestampMs = event.currentTarget.currentTime * 1000
          trailRef.current = resetBallTrail()
          setPresentedTimestampMs(timestampMs)
          onTimeUpdate?.(timestampMs)
        }}
      />
      <canvas
        ref={canvasRef}
        className="composite-overlay"
        role="img"
        aria-label="Body and ball overlay"
      />
      <ShotProgressRail
        segments={shotSegments}
        durationMs={Math.max(
          1,
          videoRef.current?.duration
            ? videoRef.current.duration * 1000
            : ballTrack?.timeline.durationMs ?? 1,
        )}
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
