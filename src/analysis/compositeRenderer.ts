import {
  BALL_TRAIL_MAX_AGE_MS,
  ballFrameAtTime,
  resetBallTrail,
  updateBallTrail,
  type BallTrailState,
} from './ballOverlayModel'
import { poseFrameAtTime } from './overlayModel'
import type { PrecomputedBallTrack } from './precomputedBallTrack'
import type { PoseFrame } from './types'
import { containVideoRect } from './videoGeometry'

export const POSE_CONNECTIONS = [
  [11, 12],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
] as const

export interface OverlayToggles {
  body: boolean
  ball: boolean
}

export interface CompositeRenderSettings {
  ballMarkerScale: number
  ballTrailLineWidth: number
  ballTrailMaxPoints: number
  bodyLineWidth: number
  bodyJointRadius: number
}

export const DEFAULT_COMPOSITE_RENDER_SETTINGS: CompositeRenderSettings = {
  ballMarkerScale: 1,
  ballTrailLineWidth: 1.8,
  ballTrailMaxPoints: 18,
  bodyLineWidth: 2.2,
  bodyJointRadius: 2.6,
}

export interface CompositeOverlayInput {
  timestampMs: number
  sourceWidth: number
  sourceHeight: number
  poseFrames?: PoseFrame[]
  ballTrack?: PrecomputedBallTrack
  toggles: OverlayToggles
  settings: CompositeRenderSettings
  playerLabel?: string
}

const drawPose = (
  context: CanvasRenderingContext2D,
  frame: PoseFrame,
  input: CompositeOverlayInput,
) => {
  const pose = frame.poses[0]
  if (!pose) return
  const rect = containVideoRect(
    input.sourceWidth,
    input.sourceHeight,
    context.canvas.width,
    context.canvas.height,
  )
  const eligible = (index: number) =>
    Boolean(pose[index]) && (pose[index].visibility ?? 0) >= 0.45
  const point = (index: number) => ({
    x: rect.x + pose[index].x * rect.width,
    y: rect.y + pose[index].y * rect.height,
  })
  const lineWidth = Math.max(0.6, input.settings.bodyLineWidth * rect.scale)
  const radius = Math.max(0.8, input.settings.bodyJointRadius * rect.scale)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = lineWidth
  context.strokeStyle = 'rgba(51, 224, 255, 0.72)'
  for (const [from, to] of POSE_CONNECTIONS) {
    if (!eligible(from) || !eligible(to)) continue
    const start = point(from)
    const end = point(to)
    context.beginPath()
    context.moveTo(start.x, start.y)
    context.lineTo(end.x, end.y)
    context.stroke()
  }
  context.fillStyle = 'rgba(51, 224, 255, 0.94)'
  for (const index of new Set(POSE_CONNECTIONS.flat())) {
    if (!eligible(index)) continue
    const center = point(index)
    context.beginPath()
    context.arc(center.x, center.y, radius, 0, Math.PI * 2)
    context.fill()
  }
  if (!input.playerLabel) return
  const visible = [...new Set(POSE_CONNECTIONS.flat())].filter(eligible).map(point)
  if (!visible.length) return
  const x = Math.max(14, Math.min(...visible.map((item) => item.x)))
  const y = Math.max(18, Math.min(...visible.map((item) => item.y)) - 14)
  context.fillStyle = 'rgba(4, 18, 20, 0.82)'
  context.font = `700 ${Math.max(11, 12 * rect.scale)}px system-ui, sans-serif`
  context.fillText(input.playerLabel, x, y)
}

const drawBall = (
  context: CanvasRenderingContext2D,
  track: PrecomputedBallTrack,
  timestampMs: number,
  trail: BallTrailState,
  settings: CompositeRenderSettings,
) => {
  const frame = ballFrameAtTime(track, timestampMs)
  const nextTrail = updateBallTrail(trail, frame, track, {
    maxPoints: settings.ballTrailMaxPoints,
  })
  if (!frame || frame.s !== 'observed') return nextTrail
  const rect = containVideoRect(
    track.coordinateSpace.width,
    track.coordinateSpace.height,
    context.canvas.width,
    context.canvas.height,
  )
  const points = nextTrail.points
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = Math.max(0.6, settings.ballTrailLineWidth * rect.scale)
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const opacity = Math.max(
      0.08,
      0.48 * (1 - (frame.t - current.timestampMs) / BALL_TRAIL_MAX_AGE_MS),
    )
    context.strokeStyle = `rgba(89, 255, 123, ${opacity})`
    context.beginPath()
    context.moveTo(rect.x + previous.x * rect.scale, rect.y + previous.y * rect.scale)
    context.lineTo(rect.x + current.x * rect.scale, rect.y + current.y * rect.scale)
    context.stroke()
  }
  const marker = points.at(-1)
  if (!marker) return nextTrail
  context.fillStyle = 'rgba(103, 255, 123, 0.14)'
  context.strokeStyle = 'rgba(103, 255, 123, 0.96)'
  context.lineWidth = Math.max(1.2, 1.7 * rect.scale)
  context.beginPath()
  context.arc(
    rect.x + marker.x * rect.scale,
    rect.y + marker.y * rect.scale,
    Math.max(1.5, marker.radius * settings.ballMarkerScale * rect.scale),
    0,
    Math.PI * 2,
  )
  context.fill()
  context.stroke()
  return nextTrail
}

export const renderCompositeOverlay = (
  context: CanvasRenderingContext2D,
  input: CompositeOverlayInput,
  previousTrail: BallTrailState = resetBallTrail(),
  clear = true,
) => {
  if (clear) context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  if (input.toggles.body && input.poseFrames?.length) {
    const frame = poseFrameAtTime(input.poseFrames, input.timestampMs)
    if (frame) drawPose(context, frame, input)
  }
  const trail = input.toggles.ball && input.ballTrack
    ? drawBall(
      context,
      input.ballTrack,
      input.timestampMs,
      previousTrail,
      input.settings,
    )
    : resetBallTrail()
  return trail
}

export const renderCompositeFrame = (
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  input: CompositeOverlayInput,
  previousTrail: BallTrailState = resetBallTrail(),
) => {
  context.fillStyle = '#020504'
  context.fillRect(0, 0, context.canvas.width, context.canvas.height)
  const rect = containVideoRect(
    input.sourceWidth,
    input.sourceHeight,
    context.canvas.width,
    context.canvas.height,
  )
  context.drawImage(video, rect.x, rect.y, rect.width, rect.height)
  return renderCompositeOverlay(context, input, previousTrail, false)
}
