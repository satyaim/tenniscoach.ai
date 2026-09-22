import { type PoseFrame, type ReliabilityBand, type StrokeSegment } from './types'
import { distance, median } from './math'

const medianAbsoluteDeviation = (values: number[]) => {
  const center = median(values)
  return median(values.map((value) => Math.abs(value - center)))
}

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))] ?? 0
}

const bandFor = (value: number, high: number, medium: number, low: number): ReliabilityBand =>
  value >= high ? 'high' : value >= medium ? 'medium' : value >= low ? 'low' : 'insufficient'

export const segmentStrokes = (
  frames: PoseFrame[],
  handedness: 'right' | 'left',
): StrokeSegment[] => {
  const wristIndex = handedness === 'right' ? 16 : 15
  const intervals = frames.slice(1).map((frame, index) => frame.timestampMs - frames[index].timestampMs).filter((value) => value > 0)
  const medianIntervalMs = median(intervals)
  const intervalIqrMs = percentile(intervals, 0.75) - percentile(intervals, 0.25)
  const maxGapMs = Math.max(...intervals, 0)
  const speeds = frames.map((frame, index) => {
    if (index === 0 || frame.poses.length !== 1 || frames[index - 1].poses.length !== 1) return Number.NaN
    const current = frame.poses[0]?.[wristIndex]
    const previous = frames[index - 1].poses[0]?.[wristIndex]
    const elapsed = frame.timestampMs - frames[index - 1].timestampMs
    if (!current || !previous || elapsed <= 0 || elapsed > Math.max(250, medianIntervalMs * 2)) return Number.NaN
    return (distance(current, previous) / elapsed) * 1000
  })
  const segments: StrokeSegment[] = []
  let onsetCandidate: number | undefined
  let onsetFrame: number | undefined
  let peakFrame = 0
  let peakSpeed = 0
  let quietStart: number | undefined

  for (let index = 1; index < frames.length; index += 1) {
    const speed = speeds[index]
    if (!Number.isFinite(speed)) {
      onsetCandidate = undefined
      if (onsetFrame !== undefined) quietStart ??= index
      continue
    }
    const prior = speeds
      .slice(0, index)
      .filter(Number.isFinite)
      .slice(-Math.max(5, Math.round(1500 / Math.max(1, medianIntervalMs))))
    if (frames[index].timestampMs < 500 || prior.length < 5) continue
    const baseline = percentile(prior, 0.3)
    const threshold = Math.max(0.025, baseline + Math.max(0.012, medianAbsoluteDeviation(prior) * 3))

    if (onsetFrame === undefined) {
      if (speed >= threshold) {
        if (onsetCandidate === undefined) onsetCandidate = index
        if (frames[index].timestampMs - frames[onsetCandidate].timestampMs >= Math.max(80, medianIntervalMs * 0.8)) {
          onsetFrame = onsetCandidate
          peakFrame = index
          peakSpeed = speed
          quietStart = undefined
        }
      } else {
        onsetCandidate = undefined
      }
      continue
    }

    if (speed > peakSpeed) {
      peakFrame = index
      peakSpeed = speed
    }
    const quietThreshold = Math.max(0.02, peakSpeed * 0.28)
    if (speed <= quietThreshold) quietStart ??= index
    else quietStart = undefined
    if (quietStart === undefined || frames[index].timestampMs - frames[quietStart].timestampMs < 300) continue

    const confirmedOnset = onsetFrame
    const offsetFrame = quietStart
    const preContextStart = frames.findIndex((frame) => frame.timestampMs >= frames[confirmedOnset].timestampMs - 500)
    const endFrame = index
    const duration = frames[offsetFrame].timestampMs - frames[onsetFrame].timestampMs
    const segmentFrames = frames.slice(preContextStart, endFrame + 1)
    const segmentIntervals = segmentFrames.slice(1)
      .map((frame, frameIndex) => frame.timestampMs - segmentFrames[frameIndex].timestampMs)
      .filter((value) => value > 0)
    const segmentMaxGapMs = Math.max(...segmentIntervals, 0)
    const visibleFrames = segmentFrames.filter((frame) => frame.poses.length === 1).length
    const coverage = visibleFrames / segmentFrames.length
    const shoulderWidths = segmentFrames.flatMap((frame) => {
      const pose = frame.poses[0]
      return pose?.[11] && pose?.[12] ? [distance(pose[11], pose[12])] : []
    })
    const scaleCenter = median(shoulderWidths)
    const scaleStability = scaleCenter > 0
      ? Math.max(0, 1 - medianAbsoluteDeviation(shoulderWidths) / scaleCenter)
      : 0
    const validBefore = speeds.slice(preContextStart, peakFrame).filter(Number.isFinite).length
    const validAfter = speeds.slice(peakFrame + 1, endFrame + 1).filter(Number.isFinite).length
    const effectiveFps = medianIntervalMs > 0 ? 1000 / medianIntervalMs : 0
    const eventProminence = baseline > 0 ? peakSpeed / baseline : peakSpeed / 0.025
    const poseEvidence = bandFor(Math.min(coverage, scaleStability), 0.9, 0.78, 0.65)
    const boundaryReliability = bandFor(
      Math.min(validBefore / 5, validAfter / 5, 300 / Math.max(300, frames[index].timestampMs - frames[quietStart].timestampMs)),
      0.95,
      0.8,
      0.65,
    )
    const hasContext =
      frames[confirmedOnset].timestampMs - frames[preContextStart].timestampMs >= 480 &&
      frames[index].timestampMs - frames[offsetFrame].timestampMs >= 300
    const valid =
      hasContext &&
      duration >= 300 &&
      duration <= 3500 &&
      validBefore >= 5 &&
      validAfter >= 5 &&
      effectiveFps >= 15 &&
      poseEvidence !== 'insufficient' &&
      boundaryReliability !== 'insufficient'
    if (valid) {
      segments.push({
        id: `movement-${Math.round(frames[peakFrame].timestampMs)}`,
        revision: 1,
        status: 'final',
        source: 'automatic',
        startFrame: preContextStart,
        onsetFrame: confirmedOnset,
        peakFrame,
        offsetFrame,
        endFrame,
        startMs: frames[preContextStart].timestampMs,
        onsetMs: frames[confirmedOnset].timestampMs,
        peakMs: frames[peakFrame].timestampMs,
        offsetMs: frames[offsetFrame].timestampMs,
        endMs: frames[endFrame].timestampMs,
        reliability: boundaryReliability,
        poseEvidence,
        boundaryReliability,
        boundaryUncertaintyMs: Math.round(Math.max(medianIntervalMs, intervalIqrMs * 2)),
        ...(effectiveFps >= 30 ? { peakWristSpeed: Number(peakSpeed.toFixed(3)) } : {}),
        diagnostics: {
          effectiveFps: Number(effectiveFps.toFixed(2)),
          medianIntervalMs: Number(medianIntervalMs.toFixed(1)),
          intervalIqrMs: Number(intervalIqrMs.toFixed(1)),
          maxGapMs: Number(segmentMaxGapMs.toFixed(1)),
          poseCoverage: Number(coverage.toFixed(3)),
          scaleStability: Number(scaleStability.toFixed(3)),
          eventProminence: Number(eventProminence.toFixed(2)),
        },
        warnings: [
          ...(effectiveFps < 30 ? ['Sampling is below 30 Hz; wrist-speed magnitude is withheld.'] : []),
          ...(boundaryReliability === 'low' ? ['Candidate boundaries have limited temporal evidence.'] : []),
        ],
      })
    }
    onsetCandidate = undefined
    onsetFrame = undefined
    peakFrame = 0
    peakSpeed = 0
    quietStart = undefined
  }

  if (!segments.length) {
    const peaks = speeds
      .map((speed, index) => ({ speed, index }))
      .filter((item) => Number.isFinite(item.speed) && item.speed >= 0.025)
      .sort((left, right) => right.speed - left.speed)
      .reduce<Array<{ speed: number; index: number }>>((selected, candidate) => {
        if (selected.every((item) => Math.abs(frames[item.index].timestampMs - frames[candidate.index].timestampMs) >= 700)) {
          selected.push(candidate)
        }
        return selected
      }, [])
      .slice(0, 8)
      .sort((left, right) => left.index - right.index)
    const visiblePeaks = peaks.length
      ? peaks
      : [{ speed: 0, index: Math.min(frames.length - 1, Math.max(0, Math.floor(frames.length / 2))) }]
    return visiblePeaks.map((candidate) => {
      const startFrame = Math.max(0, frames.findIndex((frame) => frame.timestampMs >= frames[candidate.index].timestampMs - 900))
      const endFrameCandidate = frames.findIndex((frame) => frame.timestampMs >= frames[candidate.index].timestampMs + 900)
      const endFrame = endFrameCandidate < 0 ? frames.length - 1 : endFrameCandidate
      const segmentFrames = frames.slice(startFrame, endFrame + 1)
      const poseCoverage = segmentFrames.filter((frame) => frame.poses.length === 1).length / segmentFrames.length
      const effectiveFps = medianIntervalMs > 0 ? 1000 / medianIntervalMs : 0
      return {
        id: `movement-${Math.round(frames[candidate.index].timestampMs)}`,
        revision: 1,
        status: 'provisional' as const,
        source: 'automatic' as const,
        startFrame,
        onsetFrame: startFrame,
        peakFrame: candidate.index,
        offsetFrame: endFrame,
        endFrame,
        startMs: frames[startFrame].timestampMs,
        onsetMs: frames[startFrame].timestampMs,
        peakMs: frames[candidate.index].timestampMs,
        offsetMs: frames[endFrame].timestampMs,
        endMs: frames[endFrame].timestampMs,
        reliability: 'insufficient' as const,
        poseEvidence: bandFor(poseCoverage, 0.9, 0.75, 0.55),
        boundaryReliability: 'insufficient' as const,
        boundaryUncertaintyMs: Math.round(Math.max(medianIntervalMs * 2, 120)),
        ...(effectiveFps >= 30 ? { peakWristSpeed: Number(candidate.speed.toFixed(3)) } : {}),
        diagnostics: {
          effectiveFps: Number(effectiveFps.toFixed(2)),
          medianIntervalMs: Number(medianIntervalMs.toFixed(1)),
          intervalIqrMs: Number(intervalIqrMs.toFixed(1)),
          maxGapMs: Number(maxGapMs.toFixed(1)),
          poseCoverage: Number(poseCoverage.toFixed(3)),
          scaleStability: 0,
          eventProminence: Number((candidate.speed / 0.025).toFixed(2)),
        },
        warnings: [
          candidate.speed > 0
            ? 'Possible movement peak only; clean chapter boundaries did not meet finalization gates.'
            : 'No distinct movement peak was estimated; this neutral review range keeps playback available.',
          'Descriptors and coaching are withheld. Review or adjust this range manually.',
        ],
      }
    })
  }
  return segments
}
