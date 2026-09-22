import type { PoseFrame, PoseLandmark } from './types'

const point = (x: number, y: number, visibility = 0.96): PoseLandmark => ({
  x,
  y,
  z: 0,
  visibility,
})

const makePose = (phase: number): PoseLandmark[] => {
  const pose = Array.from({ length: 33 }, () => point(0.5, 0.5, 0.92))
  const motionPhase = Math.min(1, phase / 0.78)
  const swing = Math.max(0, Math.min(1, (motionPhase - 0.23) / 0.52))
  const preparation = Math.sin(Math.min(1, motionPhase / 0.38) * Math.PI * 0.5)
  const finish = Math.max(0, (motionPhase - 0.72) / 0.28)
  const hipShift = motionPhase > 0.62 ? (motionPhase - 0.62) * 0.09 : 0

  pose[0] = point(0.5, 0.18)
  pose[11] = point(0.43 - preparation * 0.025, 0.32)
  pose[12] = point(0.57 + preparation * 0.025, 0.34)
  pose[13] = point(0.41, 0.46)
  pose[14] = point(0.59 - swing * 0.08, 0.45 - finish * 0.08)
  pose[15] = point(0.39, 0.56)
  // A deliberately crowded right-handed groundstroke movement fixture.
  pose[16] = point(0.72 - swing * 0.21, 0.54 - finish * 0.19)
  pose[23] = point(0.46 + hipShift, 0.61)
  pose[24] = point(0.56 + hipShift, 0.61)
  pose[25] = point(0.45 + hipShift, 0.78)
  pose[26] = point(0.57 + hipShift, 0.78)
  pose[27] = point(0.43 + hipShift, 0.94)
  pose[28] = point(0.6 + hipShift, 0.94)
  return pose
}

export const demoFrames: PoseFrame[] = Array.from({ length: 48 }, (_, index) => ({
  timestampMs: index * 60,
  poses: [makePose(index / 47)],
}))

export const demoDurationMs = demoFrames.at(-1)!.timestampMs
