import { useEffect, useRef } from 'react'
import {
  BALL_TRAIL_MAX_AGE_MS,
  ballFrameAtTime,
  resetBallTrail,
  updateBallTrail,
  type BallTrailState,
} from '../analysis/ballOverlayModel'
import type { PrecomputedBallTrack } from '../analysis/precomputedBallTrack'
import { containVideoRect } from '../analysis/videoGeometry'

interface BallOverlayProps {
  track: PrecomputedBallTrack
  timestampMs: number
  resetToken: number
}

export function BallOverlay({ track, timestampMs, resetToken }: BallOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trailRef = useRef<BallTrailState>(resetBallTrail())

  useEffect(() => {
    trailRef.current = resetBallTrail()
  }, [resetToken, track])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const frame = ballFrameAtTime(track, timestampMs)
    trailRef.current = updateBallTrail(trailRef.current, frame, track)

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

      if (!frame || frame.s !== 'observed') return
      const rect = containVideoRect(
        track.coordinateSpace.width,
        track.coordinateSpace.height,
        width,
        height,
      )
      const points = trailRef.current.points
      if (points.length > 1) {
        context.lineCap = 'round'
        context.lineJoin = 'round'
        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1]
          const current = points[index]
          const age = frame.t - current.timestampMs
          const opacity = Math.max(0.08, 0.48 * (1 - age / BALL_TRAIL_MAX_AGE_MS))
          context.strokeStyle = `rgba(89, 255, 123, ${opacity})`
          context.lineWidth = Math.max(1, 2.25 * rect.scale)
          context.beginPath()
          context.moveTo(rect.x + previous.x * rect.scale, rect.y + previous.y * rect.scale)
          context.lineTo(rect.x + current.x * rect.scale, rect.y + current.y * rect.scale)
          context.stroke()
        }
      }
      const marker = points.at(-1)
      if (!marker) return
      const x = rect.x + marker.x * rect.scale
      const y = rect.y + marker.y * rect.scale
      const radius = marker.radius * rect.scale
      context.fillStyle = 'rgba(103, 255, 123, 0.12)'
      context.strokeStyle = 'rgba(103, 255, 123, 0.94)'
      context.lineWidth = Math.max(1.25, 2 * rect.scale)
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }

    draw()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(draw)
    observer?.observe(canvas)
    window.addEventListener('resize', draw)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', draw)
    }
  }, [timestampMs, track])

  return (
    <canvas
      ref={canvasRef}
      className="ball-overlay"
      role="img"
      aria-label="Precomputed observed ball overlay"
    />
  )
}
