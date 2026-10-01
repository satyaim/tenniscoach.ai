import type { PrecomputedBallFrame, PrecomputedBallTrack } from './precomputedBallTrack'

export const BALL_TRAIL_MAX_POINTS = 18
export const BALL_TRAIL_MAX_AGE_MS = 650
export const BALL_DEFAULT_VISUAL_RADIUS_PX = 6

export interface BallTrailPoint {
  x: number
  y: number
  timestampMs: number
  radius: number
}

export interface BallTrailState {
  points: BallTrailPoint[]
  lastTimestampMs?: number
}

export interface BallTrailOptions {
  maxPoints?: number
  maxAgeMs?: number
}

export const ballFrameAtTime = (
  track: PrecomputedBallTrack,
  timestampMs: number,
): PrecomputedBallFrame | undefined => {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) return undefined
  const targetIndex = Math.round(timestampMs * track.timeline.fps / 1000)
  const frame = track.frames[targetIndex]
  if (!frame) return undefined
  const toleranceMs = 500 / track.timeline.fps + 0.001
  return Math.abs(frame.t - timestampMs) <= toleranceMs ? frame : undefined
}

export const markerRadius = (sourceRadius?: number) =>
  Math.min(18, Math.max(3, sourceRadius === undefined
    ? BALL_DEFAULT_VISUAL_RADIUS_PX
    : sourceRadius + 1.5))

export const ballTrailTrackIdentity = (track?: PrecomputedBallTrack) => track
  ? `${track.sourceSha256}:${track.timeline.fps}:${track.coordinateSpace.width}x${track.coordinateSpace.height}`
  : undefined

export const resetBallTrail = (): BallTrailState => ({ points: [] })

export const updateBallTrail = (
  state: BallTrailState,
  frame: PrecomputedBallFrame | undefined,
  track: PrecomputedBallTrack,
  options: BallTrailOptions = {},
): BallTrailState => {
  if (!frame || frame.s !== 'observed' || frame.x === undefined || frame.y === undefined) {
    return resetBallTrail()
  }
  if (frame.t === state.lastTimestampMs) return state
  const maxAgeMs = Math.min(
    BALL_TRAIL_MAX_AGE_MS,
    Math.max(50, options.maxAgeMs ?? BALL_TRAIL_MAX_AGE_MS),
  )
  const maxPoints = Math.min(
    36,
    Math.max(1, Math.round(options.maxPoints ?? BALL_TRAIL_MAX_POINTS)),
  )
  const framePeriodMs = 1000 / track.timeline.fps
  if (
    state.lastTimestampMs !== undefined
    && (
      frame.t < state.lastTimestampMs
      || frame.t - state.lastTimestampMs > Math.max(100, framePeriodMs * 3.1)
    )
  ) return {
    points: [{ x: frame.x, y: frame.y, timestampMs: frame.t, radius: markerRadius(frame.r) }],
    lastTimestampMs: frame.t,
  }
  const previous = state.points.at(-1)
  const maximumDistance = Math.hypot(
    track.coordinateSpace.width,
    track.coordinateSpace.height,
  ) * 0.35
  if (previous && Math.hypot(frame.x - previous.x, frame.y - previous.y) > maximumDistance) {
    return {
      points: [{ x: frame.x, y: frame.y, timestampMs: frame.t, radius: markerRadius(frame.r) }],
      lastTimestampMs: frame.t,
    }
  }
  const next = [
    ...state.points.filter((point) => frame.t - point.timestampMs <= maxAgeMs),
    { x: frame.x, y: frame.y, timestampMs: frame.t, radius: markerRadius(frame.r) },
  ]
  return {
    points: next.slice(-maxPoints),
    lastTimestampMs: frame.t,
  }
}
