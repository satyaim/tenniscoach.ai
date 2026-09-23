import type { PrecomputedBallTrack } from './precomputedBallTrack'
import type { StrokeSegment } from './types'

const MIN_NAVIGATION_GAP_MS = 100

const nonOverlappingSegments = (segments: StrokeSegment[]) => {
  const selected: StrokeSegment[] = []
  let lastOffsetMs = Number.NEGATIVE_INFINITY
  for (const segment of [...segments].sort((left, right) =>
    left.offsetMs - right.offsetMs || left.onsetMs - right.onsetMs)) {
    if (segment.onsetMs < lastOffsetMs + MIN_NAVIGATION_GAP_MS) continue
    selected.push(segment)
    lastOffsetMs = segment.offsetMs
  }
  return selected.sort((left, right) => left.onsetMs - right.onsetMs)
}

export const shotSegmentsWithBallEvidence = (
  segments: StrokeSegment[],
  track?: PrecomputedBallTrack,
) => {
  if (!track) return []
  const eligible = segments
    .filter((segment) =>
      segment.status !== 'withheld'
      && track.frames.some((frame) =>
        frame.s === 'observed'
        && frame.t >= segment.onsetMs
        && frame.t <= segment.offsetMs))
  return nonOverlappingSegments(eligible)
}
