import { describe, expect, it } from 'vitest'
import { demoDurationMs, demoFrames } from './demoFixture'
import { HeuristicStrokeAnalyzer } from './heuristicAnalyzer'
import { AnalysisError, type PoseFrame, type StrokeSegment } from './types'

const analyzer = new HeuristicStrokeAnalyzer()
const segment: StrokeSegment = {
  id: 'stroke-1',
  revision: 1,
  status: 'final',
  source: 'automatic',
  startFrame: 0,
  onsetFrame: 5,
  peakFrame: 31,
  offsetFrame: demoFrames.length - 4,
  endFrame: demoFrames.length - 1,
  startMs: 0,
  onsetMs: demoFrames[5].timestampMs,
  peakMs: demoFrames[31].timestampMs,
  offsetMs: demoFrames.at(-4)!.timestampMs,
  endMs: demoDurationMs,
  reliability: 'high',
  poseEvidence: 'high',
  boundaryReliability: 'high',
  boundaryUncertaintyMs: 100,
  peakWristSpeed: 1,
  diagnostics: {
    effectiveFps: 30,
    medianIntervalMs: 33.3,
    intervalIqrMs: 0,
    maxGapMs: 100,
    poseCoverage: 1,
    scaleStability: 1,
    eventProminence: 4,
  },
  warnings: [],
}

const input = {
  frames: demoFrames,
  durationMs: demoDurationMs,
  handedness: 'right' as const,
  requestedStroke: 'forehand' as const,
  source: 'demo' as const,
  coachingMode: 'observations-only' as const,
  captureContext: {
    viewpoint: 'test-fixed',
    cameraMotion: 'fixed' as const,
    cuts: 'none' as const,
    resolution: '1280x720',
    sourceFps: 30,
    samplingConfig: 'test-30fps',
    normalizationGeometry: 'shoulder-width-2d-v1' as const,
  },
  segment,
}

describe('HeuristicStrokeAnalyzer', () => {
  it('returns deterministic descriptive observations without contact timing or scores', async () => {
    const first = await analyzer.analyze(input)
    const second = await analyzer.analyze(input)

    expect(second).toEqual(first)
    expect(first.stroke).toBe('forehand')
    expect(first.strokeSource).toBe('selected')
    expect(first.timing).toBeNull()
    expect(first.observations).toHaveLength(4)
    expect(first.observations.every((item) => !('score' in item))).toBe(true)
    expect(first.coachingNote).toMatch(/coach label required/i)
    expect(first.drill).toBeUndefined()
    expect(JSON.stringify(first)).not.toMatch(/early|on-time|late|contact proxy/i)
  })

  it('withholds implausible post-peak paths instead of converting them to advice', async () => {
    const implausible = demoFrames.map((frame, index) => ({
      ...frame,
      poses: [frame.poses[0].map((point, pointIndex) =>
        pointIndex === 16 && index === demoFrames.length - 1 ? { ...point, x: point.x + 2 } : point)],
    }))
    const result = await analyzer.analyze({ ...input, frames: implausible })
    expect(result.observations.find((item) => item.id === 'postPeakPath')).toMatchObject({
      state: 'not_observable',
      reliability: 'insufficient',
    })
  })

  it('withholds coaching when no player is visible', async () => {
    const empty: PoseFrame[] = demoFrames.map((frame) => ({ ...frame, poses: [] }))
    await expect(analyzer.analyze({ ...input, frames: empty })).rejects.toMatchObject<Partial<AnalysisError>>({
      code: 'NO_PERSON',
    })
  })

  it('rejects unisolated multiple-person frames', async () => {
    const multiple: PoseFrame[] = demoFrames.map((frame) => ({
      ...frame,
      poses: [frame.poses[0], frame.poses[0]],
    }))
    await expect(analyzer.analyze({ ...input, frames: multiple })).rejects.toMatchObject<Partial<AnalysisError>>({
      code: 'MULTIPLE_PEOPLE',
    })
  })

  it('marks serve groundstroke spacing as not applicable', async () => {
    const result = await analyzer.analyze({
      ...input,
      handedness: 'left',
      requestedStroke: 'serve',
      source: 'upload',
    })
    expect(result.stroke).toBe('serve')
    expect(result.observations.find((item) => item.id === 'spacing')).toMatchObject({
      state: 'not_applicable',
      reliability: 'insufficient',
    })
  })

  it.each([
    [5.9, 'final'],
    [30, 'provisional'],
  ] as const)('abstains when the evidence gate fails at %s Hz', async (effectiveFps, status) => {
    const result = await analyzer.analyze({
      ...input,
      segment: {
        ...segment,
        status,
        diagnostics: { ...segment.diagnostics, effectiveFps },
      },
    })

    expect(result.strokePresentation).toEqual({
      label: 'forehand',
      provenance: 'player-selected',
    })
    expect(result.observations.every((item) =>
      item.state === 'not_observable' || item.state === 'not_applicable')).toBe(true)
  })

  it('allows conservative image-plane observations at 6 Hz while withholding speed magnitude', async () => {
    const result = await analyzer.analyze({
      ...input,
      segment: {
        ...segment,
        peakWristSpeed: undefined,
        diagnostics: { ...segment.diagnostics, effectiveFps: 6 },
      },
    })

    expect(result.observations.some((item) => item.state === 'present' || item.state === 'partial')).toBe(true)
    expect(result.segment.peakWristSpeed).toBeUndefined()
  })

  it('qualifies an automatic stroke hypothesis when descriptor evidence is eligible', async () => {
    const result = await analyzer.analyze({
      ...input,
      requestedStroke: 'auto',
      segment,
    })

    expect(result.strokePresentation.provenance).toBe('automatic')
    expect(result.strokePresentation.label).toMatch(/-like motion$/)
    expect(result.strokePresentation.label).not.toMatch(/^(Forehand|Backhand|Serve)$/)
  })

  it('keeps automatic stroke identity unavailable for the uploaded-video POC', async () => {
    const result = await analyzer.analyze({
      ...input,
      requestedStroke: 'auto',
      allowStrokeHypothesis: false,
      source: 'upload',
      segment,
    })

    expect(result.stroke).toBe('unknown')
    expect(result.strokePresentation).toEqual({
      label: 'unknown motion',
      provenance: 'unknown',
    })
  })

  it('keeps handedness unknown and abstains when no stable active wrist exists', async () => {
    const symmetric = demoFrames.map((frame) => ({
      ...frame,
      poses: [frame.poses[0].map((point, index) => index === 15 ? { ...frame.poses[0][16] } : point)],
    }))
    const result = await analyzer.analyze({
      ...input,
      frames: symmetric,
      handedness: 'unknown',
      requestedStroke: 'auto',
      allowStrokeHypothesis: false,
    })

    expect(result.handedness).toBe('unknown')
    expect(result.observations.find((item) => item.id === 'spacing')).toMatchObject({
      state: 'not_observable',
      abstentionReason: expect.stringMatching(/stable active wrist/i),
    })
    expect(result.observations.find((item) => item.id === 'postPeakPath')).toMatchObject({
      state: 'not_observable',
    })
  })
})
