import { angleDegrees, deltaAngle, distance, median, midpoint } from './math'
import {
  AnalysisError,
  type AnalysisInput,
  type AnalysisResult,
  type MeasuredObservation,
  type QualityBand,
  type ReliabilityBand,
  type ResolvedStroke,
  type StrokeAnalyzer,
} from './types'

const REQUIRED = [0, 11, 12, 13, 14, 15, 16, 23, 24, 27, 28]

const reliabilityFor = (coverage: number): ReliabilityBand =>
  coverage >= 0.9 ? 'high' : coverage >= 0.75 ? 'medium' : coverage >= 0.6 ? 'low' : 'insufficient'

const qualityFor = (coverage: number): QualityBand =>
  coverage >= 0.9 ? 'good' : coverage >= 0.75 ? 'usable' : coverage >= 0.6 ? 'limited' : 'insufficient'

const resolveStroke = (
  input: AnalysisInput,
  poses: NonNullable<AnalysisInput['frames'][number]['poses'][number]>[],
  wristIndex: number,
): { stroke: ResolvedStroke; source: AnalysisResult['strokeSource'] } => {
  if (input.requestedStroke !== 'auto') return { stroke: input.requestedStroke, source: 'selected' }
  if (input.allowStrokeHypothesis === false) return { stroke: 'unknown', source: 'unknown' }
  const wristAboveHeadRatio =
    poses.filter((pose) => pose[wristIndex]?.y < pose[0]?.y - 0.02).length / Math.max(1, poses.length)
  if (wristAboveHeadRatio >= 0.18) return { stroke: 'serve', source: 'hypothesis' }
  const centers = poses.map((pose) => midpoint(pose[11], pose[12]).x)
  const wristXs = poses.map((pose) => pose[wristIndex].x)
  const range = Math.max(...wristXs) - Math.min(...wristXs)
  if (range < 0.07) return { stroke: 'unknown', source: 'unknown' }
  const crossed = wristXs.some((x, index) =>
    wristIndex === 16 ? x < centers[index] - 0.03 : x > centers[index] + 0.03,
  )
  return { stroke: crossed ? 'backhand' : 'forehand', source: 'hypothesis' }
}

const observation = (
  value: Omit<MeasuredObservation, 'reliability'> & { reliability?: ReliabilityBand },
  fallbackReliability: ReliabilityBand,
): MeasuredObservation => ({ ...value, reliability: value.reliability ?? fallbackReliability })

const strokePresentation = (
  stroke: ResolvedStroke,
  source: AnalysisResult['strokeSource'],
): AnalysisResult['strokePresentation'] => {
  if (source === 'selected') return { label: stroke, provenance: 'player-selected' }
  if (source === 'hypothesis' && stroke !== 'unknown') {
    return { label: `${stroke}-like motion`, provenance: 'automatic' }
  }
  return { label: 'unknown motion', provenance: 'unknown' }
}

const activeWristFor = (frames: AnalysisInput['frames']) => {
  const movement = (index: 15 | 16) => frames.slice(1).reduce((total, frame, frameIndex) => {
    const current = frame.poses[0]?.[index]
    const previous = frames[frameIndex].poses[0]?.[index]
    return current && previous ? total + distance(current, previous) : total
  }, 0)
  const left = movement(15)
  const right = movement(16)
  const strongest = Math.max(left, right)
  const weakest = Math.min(left, right)
  if (strongest <= 0 || strongest / Math.max(weakest, 0.001) < 1.2) return undefined
  return left > right ? 15 as const : 16 as const
}

export class HeuristicStrokeAnalyzer implements StrokeAnalyzer {
  readonly id = 'pose-observations-v2'

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    if (input.durationMs < 500 || input.frames.length < 7) {
      throw new AnalysisError('SHORT_VIDEO', 'The selected stroke segment is too short to inspect.')
    }
    if (input.frames.some((frame) => frame.poses.length > 1)) {
      throw new AnalysisError('MULTIPLE_PEOPLE', 'Player tracks were not isolated before analysis.')
    }
    const personFrames = input.frames.filter((frame) => frame.poses.length === 1)
    if (personFrames.length / input.frames.length < 0.55) {
      throw new AnalysisError('NO_PERSON', 'The selected player was not tracked through enough of this stroke.')
    }
    const poses = personFrames.map((frame) => frame.poses[0])
    const visibilitySamples = poses.flatMap((pose) => REQUIRED.map((index) => pose[index]?.visibility ?? 0))
    const coverage = visibilitySamples.filter((value) => value >= 0.45).length / visibilitySamples.length
    if (coverage < 0.58) {
      throw new AnalysisError('LOW_VISIBILITY', 'Hands, hips, or feet are not visible enough in this stroke segment.')
    }
    const descriptorEligible =
      input.segment.status === 'final' &&
      input.segment.diagnostics.effectiveFps >= 6 &&
      ['high', 'medium'].includes(input.segment.poseEvidence) &&
      ['high', 'medium'].includes(input.segment.boundaryReliability)
    if (!descriptorEligible) {
      const stroke = input.requestedStroke === 'auto' ? 'unknown' : input.requestedStroke
      const strokeSource = input.requestedStroke === 'auto' ? 'unknown' : 'selected'
      const gateReason =
        input.segment.status !== 'final'
          ? 'The automatic chapter did not meet temporal finalization gates.'
          : input.segment.diagnostics.effectiveFps < 6
            ? `Effective sampling was ${input.segment.diagnostics.effectiveFps.toFixed(1)} Hz; movement observations require at least 6 Hz.`
            : 'Pose or boundary evidence was below medium.'
      const unavailable = (id: MeasuredObservation['id'], label: string): MeasuredObservation => ({
        id,
        label,
        state: 'not_observable',
        reliability: 'insufficient',
        evidenceBasis: gateReason,
        description: 'Withheld pending a cleaner range or manual review.',
        abstentionReason: [gateReason, ...input.segment.warnings].join(' '),
      })
      const sampledDurationSeconds = Math.max(
        0.001,
        (input.frames.at(-1)!.timestampMs - input.frames[0].timestampMs) / 1000,
      )
      return {
        analyzer: this.id,
        source: input.source,
        stroke,
        strokeSource,
        strokePresentation: strokePresentation(stroke, strokeSource),
        handedness: input.handedness,
        timing: null,
        inputQuality: qualityFor(coverage),
        poseTrackQuality: qualityFor(personFrames.length / input.frames.length),
        segmentationReliability: input.segment.boundaryReliability,
        observations: [
          unavailable('preparation', '2D shoulder-line orientation change'),
          unavailable('spacing', '2D hand-to-torso separation'),
          unavailable('pelvisProjection', 'Pelvis projection relative to visible ankle span'),
          unavailable('postPeakPath', 'Post-peak hand path'),
        ],
        mainObservation: 'Not enough eligible evidence for a descriptive movement observation.',
        coachingNote: 'No coaching, automatic stroke hypothesis, or peak-dependent descriptor is produced for this chapter.',
        moments: [
          { id: 'onset', label: input.segment.status === 'final' ? 'Movement onset' : 'Estimated range start', timestampMs: input.segment.startMs, note: input.segment.status === 'final' ? 'Automatic movement boundary' : 'Provisional boundary' },
          { id: 'preparation', label: 'Pre-peak review', timestampMs: input.segment.startMs, note: 'No finalized preparation boundary' },
          { id: 'peak', label: 'Possible movement peak', timestampMs: input.segment.peakMs, note: 'Automatic estimate; not ball contact' },
          { id: 'offset', label: input.segment.status === 'final' ? 'Movement offset' : 'Estimated range end', timestampMs: input.segment.endMs, note: input.segment.status === 'final' ? 'Automatic movement boundary' : 'Provisional boundary' },
        ],
        peakFrame: Math.max(0, Math.min(input.frames.length - 1, input.segment.peakFrame)),
        segment: {
          ...input.segment,
          sampledFrameCount: input.frames.length,
          effectiveFps: Number((input.frames.length / sampledDurationSeconds).toFixed(2)),
        },
        trace: [
          { metric: 'Pose coverage', value: Math.round(coverage * 100), unit: '%', interpretation: 'Visibility only; descriptors withheld' },
          { metric: 'Boundary uncertainty', value: input.segment.boundaryUncertaintyMs, unit: 'ms', interpretation: 'Estimated from sample timing' },
        ],
        limitations: [
          gateReason,
          'Ball and racket are not tracked; contact and timing are not observable.',
          'Automatic boundaries can be reviewed or adjusted manually.',
        ],
        safety: 'General 2D movement review only. Stop if you feel pain, numbness, dizziness, or instability.',
        captureContext: input.captureContext,
      }
    }

    const wristIndex =
      input.handedness === 'right'
        ? 16
        : input.handedness === 'left'
          ? 15
          : activeWristFor(input.frames)
    const shoulderWidths = poses.map((pose) => distance(pose[11], pose[12])).filter((value) => value > 0.025)
    const scale = median(shoulderWidths)
    if (scale <= 0.025) {
      throw new AnalysisError('LOW_VISIBILITY', 'The player is too small or clipped for stable image-plane normalization.')
    }
    const peakFrame = Math.max(
      1,
      Math.min(input.frames.length - 2, input.segment.peakFrame),
    )
    const peakPose = input.frames[peakFrame]?.poses[0] ?? poses[Math.floor(poses.length / 2)]
    const prepFrame = Math.max(0, peakFrame - Math.max(2, Math.round(input.frames.length * 0.25)))
    const prepPose = input.frames[prepFrame]?.poses[0] ?? poses[0]
    const endPose = [...input.frames].reverse().find((frame) => frame.poses[0])?.poses[0] ?? poses.at(-1)!
    const baseReliability = reliabilityFor(coverage)
    const { stroke, source } = resolveStroke(input, poses, wristIndex ?? 16)

    const startShoulderAngle = angleDegrees(poses[0][11], poses[0][12])
    const prepShoulderAngle = angleDegrees(prepPose[11], prepPose[12])
    const rawOrientationChange = deltaAngle(startShoulderAngle, prepShoulderAngle)
    const orientationChange = Math.min(rawOrientationChange, Math.abs(180 - rawOrientationChange))
    const center = midpoint(peakPose[11], peakPose[12])
    const separation = wristIndex === undefined ? undefined : distance(peakPose[wristIndex], center) / scale
    const pelvisX = midpoint(peakPose[23], peakPose[24]).x
    const ankleLeft = Math.min(peakPose[27].x, peakPose[28].x)
    const ankleRight = Math.max(peakPose[27].x, peakPose[28].x)
    const ankleSpan = Math.max(0.01, ankleRight - ankleLeft)
    const pelvisProjection = (pelvisX - ankleLeft) / ankleSpan
    const postPeakPath =
      wristIndex === undefined ? undefined : distance(peakPose[wristIndex], endPose[wristIndex]) / scale

    const observations: MeasuredObservation[] = [
      observation({
        id: 'preparation',
        label: '2D shoulder-line orientation change',
        state: orientationChange >= 15 ? 'present' : orientationChange >= 6 ? 'partial' : 'absent',
        evidenceBasis: 'Change in the projected line between visible shoulder landmarks before the movement peak.',
        measuredValue: Number(orientationChange.toFixed(1)),
        unit: 'degrees in image plane',
        description: `${orientationChange.toFixed(1)}° of image-plane shoulder-line orientation change was visible before peak wrist speed.`,
      }, baseReliability),
      wristIndex === undefined
        ? observation({
            id: 'spacing',
            label: 'Active-wrist to torso separation',
            state: 'not_observable',
            reliability: 'insufficient',
            evidenceBasis: 'Both visible wrists had similar movement; no stable active wrist was selected.',
            description: 'Active-wrist separation was withheld.',
            abstentionReason: 'The pose evidence did not identify one stable active wrist.',
          }, baseReliability)
        : stroke === 'serve'
        ? observation({
            id: 'spacing',
            label: 'Active-wrist to torso separation',
            state: 'not_applicable',
            reliability: 'insufficient',
            evidenceBasis: 'Groundstroke separation rubric is not applied to serve-shaped movement.',
            description: 'Not evaluated for a serve-shaped sequence.',
            abstentionReason: 'Serve-specific evidence has not been validated.',
          }, baseReliability)
        : separation! > 3.5
          ? observation({
              id: 'spacing',
              label: 'Active-wrist to torso separation',
              state: 'not_observable',
              reliability: 'insufficient',
              evidenceBasis: 'Peak-frame wrist distance normalized by visible shoulder width.',
              description: 'The normalized value was physically implausible and was withheld.',
              abstentionReason: 'Likely landmark, scale, or track instability.',
            }, baseReliability)
          : observation({
              id: 'spacing',
              label: 'Active-wrist to torso separation',
              state: separation! >= 0.8 ? 'present' : 'partial',
              evidenceBasis: 'Peak-frame wrist distance normalized by visible shoulder width.',
              measuredValue: Number(separation!.toFixed(2)),
              unit: 'shoulder widths',
              description: `${separation!.toFixed(2)} visible shoulder widths from the active wrist to the torso at the movement peak.`,
            }, baseReliability),
      observation({
        id: 'pelvisProjection',
        label: 'Pelvis projection relative to visible ankle span',
        state: pelvisProjection >= 0 && pelvisProjection <= 1 ? 'present' : 'partial',
        evidenceBasis: 'Horizontal mid-pelvis projection compared with the visible ankle interval at movement peak.',
        measuredValue: Number(pelvisProjection.toFixed(2)),
        unit: 'normalized ankle span',
        description: `Pelvis projection was ${pelvisProjection.toFixed(2)} across the visible ankle span (0=left ankle, 1=right ankle).`,
      }, baseReliability),
      postPeakPath === undefined
        ? observation({
            id: 'postPeakPath',
            label: 'Post-peak active-wrist path',
            state: 'not_observable',
            reliability: 'insufficient',
            evidenceBasis: 'Both visible wrists had similar movement; no stable active wrist was selected.',
            description: 'Post-peak active-wrist path was withheld.',
            abstentionReason: 'The pose evidence did not identify one stable active wrist.',
          }, baseReliability)
        : postPeakPath > 3.5
        ? observation({
            id: 'postPeakPath',
            label: 'Post-peak active-wrist path',
            state: 'not_observable',
            reliability: 'insufficient',
            evidenceBasis: 'Wrist displacement from movement peak to segmented offset, normalized by shoulder width.',
            description: 'The post-peak path was withheld as implausible.',
            abstentionReason: 'Likely segment boundary, landmark, or scale instability.',
          }, baseReliability)
        : observation({
            id: 'postPeakPath',
            label: 'Post-peak active-wrist path',
            state: postPeakPath >= 0.35 ? 'present' : 'partial',
            evidenceBasis: 'Wrist displacement from movement peak to segmented offset, normalized by shoulder width.',
            measuredValue: Number(postPeakPath.toFixed(2)),
            unit: 'shoulder widths',
            description: `${postPeakPath.toFixed(2)} visible shoulder widths of wrist path after the movement peak.`,
          }, baseReliability),
    ]
    const reliable = observations.filter((item) => item.reliability !== 'insufficient' && item.state !== 'not_applicable')
    const main = reliable[0]
    const sampledDurationSeconds = Math.max(
      0.001,
      (input.frames.at(-1)!.timestampMs - input.frames[0].timestampMs) / 1000,
    )

    return {
      analyzer: this.id,
      source: input.source,
      stroke,
      strokeSource: source,
      strokePresentation: strokePresentation(stroke, source),
      handedness: input.handedness,
      timing: null,
      inputQuality: qualityFor(coverage),
      poseTrackQuality: qualityFor(personFrames.length / input.frames.length),
      segmentationReliability: input.segment.reliability,
      observations,
      mainObservation: main?.description ?? 'No reliable pose observation is available for this segment.',
      coachingNote:
        input.coachingMode === 'reviewed-rubric'
          ? 'This segment is ready for review against an explicitly approved coaching rubric.'
          : 'Coach label required. These are image-plane observations, not a technique judgment.',
      moments: [
        { id: 'onset', label: 'Movement onset', timestampMs: input.segment.onsetMs, note: 'Rule-based movement onset' },
        { id: 'preparation', label: 'Pre-peak', timestampMs: input.frames[prepFrame].timestampMs, note: 'Pose evidence before acceleration peak' },
        { id: 'peak', label: 'Movement peak', timestampMs: input.segment.peakMs, note: 'Peak tracked-wrist-speed frame' },
        { id: 'offset', label: 'Movement offset', timestampMs: input.segment.offsetMs, note: 'Rule-based movement offset' },
      ],
      peakFrame,
      segment: {
        ...input.segment,
        sampledFrameCount: input.frames.length,
        effectiveFps: Number((input.frames.length / sampledDurationSeconds).toFixed(2)),
      },
      trace: [
        { metric: '2D shoulder-line orientation change', value: Number(orientationChange.toFixed(1)), unit: 'degrees', interpretation: 'Image-plane observation' },
        { metric: '2D active-wrist-to-torso separation', value: separation === undefined || separation > 3.5 ? 'withheld' : Number(separation.toFixed(2)), unit: 'shoulder widths', interpretation: 'Image-plane observation; not handedness' },
        { metric: 'Pelvis projection', value: Number(pelvisProjection.toFixed(2)), unit: 'ankle spans', interpretation: 'Visible-base projection only' },
        { metric: 'Post-peak active-wrist path', value: postPeakPath === undefined || postPeakPath > 3.5 ? 'withheld' : Number(postPeakPath.toFixed(2)), unit: 'shoulder widths', interpretation: 'Segmented image-plane path; not handedness' },
        { metric: 'Landmark coverage', value: Math.round(coverage * 100), unit: '%', interpretation: 'Input evidence coverage, not calibrated confidence' },
      ],
      limitations: [
        'Ball and racket are not tracked; contact and timing are not observable.',
        'All distances and angles are image-plane measurements with shoulder-width normalization.',
        'Stroke family is selected by the user or a coarse pose-shape hypothesis; unknown is allowed.',
        'Handedness is not inferred; wrist-specific observations use only a stable active-wrist signal and otherwise abstain.',
        'No force, torque, joint loading, true depth, ball speed, spin, or racket-face claim is made.',
      ],
      safety: 'General 2D movement observation only. Stop if you feel pain, numbness, dizziness, or instability.',
      captureContext: input.captureContext,
    }
  }
}

export const heuristicAnalyzer = new HeuristicStrokeAnalyzer()
