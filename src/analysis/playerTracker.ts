import { AnalysisError, type PoseFrame, type PoseLandmark } from './types'

const BODY_POINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]

interface PoseDescriptor {
  pose: PoseLandmark[]
  center: { x: number; y: number }
  width: number
  height: number
  area: number
  coverage: number
}

export interface PlayerTrack {
  id: 'A' | 'B'
  poses: Array<PoseLandmark[] | undefined>
  persistence: number
  coverage: number
  averageArea: number
  averageCenterY: number
  primaryScore: number
  warnings: string[]
}

export interface PlayerTrackingResult {
  tracks: PlayerTrack[]
  recommendedPlayerId?: PlayerTrack['id']
  selectionConfidence: number
  selectionMethod: 'auto-near'
  warnings: string[]
}

const describePose = (pose: PoseLandmark[]): PoseDescriptor | undefined => {
  const visible = BODY_POINTS.map((index) => pose[index]).filter(
    (point): point is PoseLandmark => Boolean(point) && (point.visibility ?? 0) >= 0.35,
  )
  if (visible.length < 4) return undefined
  const xs = visible.map((point) => point.x)
  const ys = visible.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = Math.max(0.02, maxX - minX)
  const height = Math.max(0.02, maxY - minY)
  return {
    pose,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width,
    height,
    area: width * height,
    coverage: visible.length / BODY_POINTS.length,
  }
}

const descriptorCost = (previous: PoseDescriptor, next: PoseDescriptor) => {
  const centerDistance = Math.hypot(previous.center.x - next.center.x, previous.center.y - next.center.y)
  const scaleChange = Math.abs(Math.log(next.area / previous.area))
  const overlapX = Math.max(
    0,
    Math.min(previous.center.x + previous.width / 2, next.center.x + next.width / 2) -
      Math.max(previous.center.x - previous.width / 2, next.center.x - next.width / 2),
  )
  const overlapY = Math.max(
    0,
    Math.min(previous.center.y + previous.height / 2, next.center.y + next.height / 2) -
      Math.max(previous.center.y - previous.height / 2, next.center.y - next.height / 2),
  )
  const intersection = overlapX * overlapY
  const union = previous.area + next.area - intersection
  const overlapPenalty = 1 - (union > 0 ? intersection / union : 0)
  return centerDistance * 2.2 + scaleChange * 0.35 + overlapPenalty * 0.18
}

export const trackPlayers = (frames: PoseFrame[]): PlayerTrackingResult => {
  if (frames.some((frame) => frame.poses.length > 2)) {
    throw new AnalysisError(
      'MULTIPLE_PEOPLE',
      'More than two people were detected. Record one court with a clear near player.',
    )
  }
  const working = [
    { id: 'A' as const, poses: Array<PoseLandmark[] | undefined>(frames.length), last: undefined as PoseDescriptor | undefined, missed: 0 },
    { id: 'B' as const, poses: Array<PoseLandmark[] | undefined>(frames.length), last: undefined as PoseDescriptor | undefined, missed: 0 },
  ]
  let initialized = false
  let orderSwapCount = 0
  let previousAssignment: Array<'A' | 'B'> = []

  frames.forEach((frame, frameIndex) => {
    const descriptors = frame.poses.map(describePose).filter((item): item is PoseDescriptor => Boolean(item))
    if (!initialized && descriptors.length) {
      descriptors
        .sort((left, right) => right.area - left.area)
        .forEach((descriptor, index) => {
          working[index].poses[frameIndex] = descriptor.pose
          working[index].last = descriptor
        })
      initialized = true
      previousAssignment = descriptors.map((_, index) => working[index].id)
      return
    }

    const assignments: Array<{ trackIndex: number; descriptorIndex: number; cost: number }> = []
    for (let trackIndex = 0; trackIndex < working.length; trackIndex += 1) {
      const previous = working[trackIndex].last
      if (!previous || working[trackIndex].missed > 3) continue
      descriptors.forEach((descriptor, descriptorIndex) => {
        assignments.push({ trackIndex, descriptorIndex, cost: descriptorCost(previous, descriptor) })
      })
    }
    assignments.sort((left, right) => left.cost - right.cost)
    const usedTracks = new Set<number>()
    const usedDescriptors = new Set<number>()
    const currentAssignment: Array<'A' | 'B'> = []
    for (const assignment of assignments) {
      if (
        assignment.cost > 1.15 ||
        usedTracks.has(assignment.trackIndex) ||
        usedDescriptors.has(assignment.descriptorIndex)
      ) continue
      const track = working[assignment.trackIndex]
      const descriptor = descriptors[assignment.descriptorIndex]
      track.poses[frameIndex] = descriptor.pose
      track.last = descriptor
      track.missed = 0
      usedTracks.add(assignment.trackIndex)
      usedDescriptors.add(assignment.descriptorIndex)
      currentAssignment[assignment.descriptorIndex] = track.id
    }
    descriptors.forEach((descriptor, descriptorIndex) => {
      if (usedDescriptors.has(descriptorIndex)) return
      const available = working.findIndex((track, index) => !usedTracks.has(index) && track.missed > 3)
      if (available < 0) return
      working[available].poses[frameIndex] = descriptor.pose
      working[available].last = descriptor
      working[available].missed = 0
      currentAssignment[descriptorIndex] = working[available].id
    })
    working.forEach((track, index) => {
      if (!usedTracks.has(index) && !track.poses[frameIndex]) track.missed += 1
    })
    if (
      previousAssignment.length === currentAssignment.length &&
      currentAssignment.some((id, index) => id && previousAssignment[index] && id !== previousAssignment[index])
    ) orderSwapCount += 1
    if (currentAssignment.length) previousAssignment = currentAssignment
  })

  const rawTracks = working
    .map((track) => {
      const descriptors = track.poses.map((pose) => pose && describePose(pose)).filter((item): item is PoseDescriptor => Boolean(item))
      const persistence = descriptors.length / Math.max(1, frames.length)
      const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
      return {
        id: track.id,
        poses: track.poses,
        persistence,
        coverage: average(descriptors.map((item) => item.coverage)),
        averageArea: average(descriptors.map((item) => item.area)),
        averageCenterY: average(descriptors.map((item) => item.center.y)),
        primaryScore: 0,
        warnings: persistence < 0.65 ? ['Track has substantial missed detections.'] : [],
      }
    })
    .filter((track) => track.persistence >= 0.2)

  const maxArea = Math.max(...rawTracks.map((track) => track.averageArea), 0.001)
  for (const track of rawTracks) {
    track.primaryScore =
      track.persistence * 0.35 +
      track.coverage * 0.25 +
      (track.averageArea / maxArea) * 0.25 +
      track.averageCenterY * 0.15
  }
  rawTracks.sort((left, right) => right.primaryScore - left.primaryScore)
  const best = rawTracks[0]
  const runnerUp = rawTracks[1]
  const scoreGap = best && runnerUp ? best.primaryScore - runnerUp.primaryScore : best?.primaryScore ?? 0
  const selectionConfidence = Math.max(0, Math.min(1, (best?.persistence ?? 0) * 0.55 + scoreGap * 1.6))
  const warnings = [
    ...(orderSwapCount > 0 ? [`Pose detection order changed ${orderSwapCount} time(s); stable tracks were used.`] : []),
    ...(scoreGap < 0.08 && runnerUp ? ['Secondary pose detections were ignored; analysis uses the strongest primary track.'] : []),
  ]
  return {
    tracks: rawTracks,
    recommendedPlayerId: best?.id,
    selectionConfidence,
    selectionMethod: 'auto-near',
    warnings,
  }
}

export const filterFramesForTrack = (frames: PoseFrame[], track: PlayerTrack): PoseFrame[] =>
  frames.map((frame, index) => ({
    timestampMs: frame.timestampMs,
    poses: track.poses[index] ? [track.poses[index]!] : [],
  }))
