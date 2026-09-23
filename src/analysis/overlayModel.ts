import type { AnalysisResult, KeyMoment, PoseFrame } from './types'

export interface ReplayOverlay {
  frame?: PoseFrame
  phase: string
  cue: string
  isUncertain: boolean
  moment?: KeyMoment
}

const nearestFrame = (frames: PoseFrame[], timestampMs: number) =>
  frames.reduce(
    (best, frame, index) =>
      Math.abs(frame.timestampMs - timestampMs) < Math.abs(frames[best].timestampMs - timestampMs)
        ? index
        : best,
    0,
  )

export const frameIndexAtTime = (frames: PoseFrame[], timestampMs: number) => {
  if (!frames.length) return 0
  return nearestFrame(frames, timestampMs)
}

export const poseFrameAtTime = (
  frames: PoseFrame[],
  timestampMs: number,
  toleranceMs = 180,
) => {
  if (!frames.length) return undefined
  const frame = frames[frameIndexAtTime(frames, timestampMs)]
  return Math.abs(frame.timestampMs - timestampMs) <= toleranceMs ? frame : undefined
}

export const trackedPoseFrameAtTime = (
  frames: PoseFrame[],
  trackedPoses: Array<PoseFrame['poses'][number] | undefined>,
  timestampMs: number,
  toleranceMs = 180,
) => {
  if (!frames.length) return undefined
  const index = frames.reduce((best, frame, candidate) => {
    if (!trackedPoses[candidate]) return best
    if (best < 0) return candidate
    return Math.abs(frame.timestampMs - timestampMs) <
      Math.abs(frames[best].timestampMs - timestampMs)
      ? candidate
      : best
  }, -1)
  if (index < 0) return undefined
  const sourceFrame = frames[index]
  const pose = trackedPoses[index]
  if (!pose || Math.abs(sourceFrame.timestampMs - timestampMs) > toleranceMs) return undefined
  return { timestampMs: sourceFrame.timestampMs, poses: [pose] } satisfies PoseFrame
}

export const overlayAtTime = (
  frames: PoseFrame[],
  result: AnalysisResult,
  timestampMs: number,
): ReplayOverlay => {
  const frame = frames[frameIndexAtTime(frames, timestampMs)]
  const moments = result.moments
  const nearestMoment = moments.reduce((best, moment) =>
    Math.abs(moment.timestampMs - timestampMs) < Math.abs(best.timestampMs - timestampMs)
      ? moment
      : best,
  )
  const toleranceMs = Math.max(180, Math.min(500, (frames.at(-1)!.timestampMs - frames[0].timestampMs) / 18))
  const moment = Math.abs(nearestMoment.timestampMs - timestampMs) <= toleranceMs ? nearestMoment : undefined
  const peak = moments.find((item) => item.id === 'peak')!
  const preparation = moments.find((item) => item.id === 'preparation')!
  const phase =
    moment?.label ??
    (timestampMs < preparation.timestampMs
      ? 'Ready'
      : timestampMs < peak.timestampMs
        ? 'Preparation'
        : 'Post-peak path')
  const isUncertain =
    result.inputQuality === 'insufficient' ||
    result.poseTrackQuality === 'insufficient' ||
    !frame?.poses[0]
  const cue = isUncertain
    ? 'Limited pose evidence — treat this segment as uncertain.'
    : moment?.id === 'peak'
      ? 'Peak tracked-wrist-speed frame — not ball contact.'
      : result.mainObservation

  return { frame, phase, cue, isUncertain, moment }
}

export const chooseWebmMimeType = (
  isTypeSupported: ((mimeType: string) => boolean) | undefined,
) => {
  if (!isTypeSupported) return undefined
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(isTypeSupported)
}

export const canExportAnnotatedVideo = () =>
  typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
  typeof MediaRecorder !== 'undefined' &&
  Boolean(chooseWebmMimeType(MediaRecorder.isTypeSupported?.bind(MediaRecorder)))

export interface LiveOverlayStatus {
  label: string
  cue: string
  tone: 'good' | 'warn' | 'neutral'
}

export const liveOverlayStatus = (
  frame: PoseFrame | undefined,
  coarseMotion: boolean,
): LiveOverlayStatus => {
  const personCount = frame?.poses.length ?? 0
  if (personCount > 1) {
    return { label: 'Multiple people', cue: 'Keep one player in frame.', tone: 'warn' }
  }
  if (personCount === 0) {
    return { label: 'Looking for player', cue: 'Step back until your full body is visible.', tone: 'neutral' }
  }
  const pose = frame!.poses[0]
  const required = [11, 12, 23, 24, 27, 28]
  const coverage = required.filter((index) => (pose[index]?.visibility ?? 0) >= 0.55).length / required.length
  if (coverage < 0.84) {
    return { label: 'Partial framing', cue: 'Keep shoulders, hips, and feet visible.', tone: 'warn' }
  }
  if (coarseMotion) {
    return { label: 'Motion change (provisional)', cue: 'Coarse live signal only; review after recording.', tone: 'neutral' }
  }
  return { label: 'Player framed', cue: 'Ready when you are.', tone: 'good' }
}
