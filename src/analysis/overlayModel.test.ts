import { describe, expect, it } from 'vitest'
import { demoFrames } from './demoFixture'
import { heuristicAnalyzer } from './heuristicAnalyzer'
import { chooseWebmMimeType, liveOverlayStatus, overlayAtTime } from './overlayModel'
import type { StrokeSegment } from './types'

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
  endMs: demoFrames.at(-1)!.timestampMs,
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

describe('annotated overlay model', () => {
  it('selects stable event labels and evidence-aware cues', async () => {
    const result = await heuristicAnalyzer.analyze({
      frames: demoFrames,
      durationMs: 4000,
      handedness: 'right',
      requestedStroke: 'forehand',
      source: 'demo',
      coachingMode: 'observations-only',
      captureContext: {
        viewpoint: 'test-fixed',
        cameraMotion: 'fixed',
        cuts: 'none',
        resolution: '1280x720',
        sourceFps: 30,
        samplingConfig: 'test-30fps',
        normalizationGeometry: 'shoulder-width-2d-v1',
      },
      segment,
    })
    const peak = result.moments.find((moment) => moment.id === 'peak')!
    const overlay = overlayAtTime(demoFrames, result, peak.timestampMs)

    expect(overlay.phase).toBe('Movement peak')
    expect(overlay.cue).toMatch(/not ball contact/i)
    expect(overlay.frame).toBeDefined()
    expect(overlay.isUncertain).toBe(false)
  })

  it('does not provide authoritative live coaching without reliable framing', () => {
    expect(liveOverlayStatus(undefined, false)).toMatchObject({
      label: 'Looking for player',
      tone: 'neutral',
    })
    expect(liveOverlayStatus({ timestampMs: 0, poses: [demoFrames[0].poses[0], demoFrames[0].poses[0]] }, false))
      .toMatchObject({ label: 'Multiple people', tone: 'warn' })
  })

  it('chooses a supported WebM codec and abstains when none are available', () => {
    expect(chooseWebmMimeType((type) => type.includes('vp8'))).toBe('video/webm;codecs=vp8')
    expect(chooseWebmMimeType(() => false)).toBeUndefined()
    expect(chooseWebmMimeType(undefined)).toBeUndefined()
  })
})
