import type { PoseLandmark } from './types'

export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value))

export const distance = (a: PoseLandmark, b: PoseLandmark) =>
  Math.hypot(a.x - b.x, a.y - b.y)

export const midpoint = (a: PoseLandmark, b: PoseLandmark): PoseLandmark => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
})

export const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export const angleDegrees = (a: PoseLandmark, b: PoseLandmark) =>
  (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI

export const deltaAngle = (a: number, b: number) => {
  const difference = Math.abs(a - b) % 360
  return difference > 180 ? 360 - difference : difference
}
