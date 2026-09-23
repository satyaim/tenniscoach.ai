import type { PrecomputedBallTrack } from './precomputedBallTrack'
import type { StrokeSegment } from './types'

export const shotSegmentsWithBallEvidence = (
  segments: StrokeSegment[],
  track?: PrecomputedBallTrack,
) => {
  if (!track) return []
  return segments
    .filter((segment) =>
      segment.status !== 'withheld'
      && track.frames.some((frame) =>
        frame.s === 'observed'
        && frame.t >= segment.onsetMs
        && frame.t <= segment.offsetMs))
    .sort((left, right) => left.startMs - right.startMs)
}
