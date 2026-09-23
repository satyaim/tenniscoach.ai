import { describe, expect, it } from 'vitest'
import { demoFrames } from './demoFixture'
import { heuristicAnalyzer } from './heuristicAnalyzer'
import {
  chooseWebmMimeType,
  liveOverlayStatus,
  overlayAtTime,
  poseFrameAtTime,
  trackedPoseFrameAtTime,
} from './overlayModel'
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
  it('suppresses stale pose frames outside the bounded timestamp tolerance', () => {
    expect(poseFrameAtTime(demoFrames, demoFrames[3].timestampMs + 20, 50)).toBe(demoFrames[3])
    expect(poseFrameAtTime(demoFrames, demoFrames.at(-1)!.timestampMs + 500, 120)).toBeUndefined()
  })

  it('maps the selected stable track without switching candidate identities', () => {
    const trackB = demoFrames.map((frame) => frame.poses[0].map((point) => ({
      ...point,
      x: point.x + 0.2,
    })))
    const targetTime = demoFrames[3].timestampMs + 20

    expect(trackedPoseFrameAtTime(demoFrames, trackB, targetTime, 50)?.poses[0][0].x)
      .toBe(trackB[3][0].x)
    expect(trackedPoseFrameAtTime(demoFrames, trackB, demoFrames.at(-1)!.timestampMs + 500, 120))
      .toBeUndefined()
  })

  it('uses the nearest eligible track pose when the nearest raw frame missed that player', () => {
    const frames = [
      { timestampMs: 0, poses: [demoFrames[0].poses[0]] },
      { timestampMs: 100, poses: [demoFrames[1].poses[0]] },
      { timestampMs: 180, poses: [demoFrames[2].poses[0]] },
    ]
    const playerB = demoFrames[1].poses[0].map((point) => ({ ...point, x: point.x + 0.25 }))
    const intermittentTrack = [undefined, playerB, undefined]

    expect(trackedPoseFrameAtTime(frames, intermittentTrack, 0)?.timestampMs).toBe(100)
    expect(trackedPoseFrameAtTime(frames, intermittentTrack, 175)?.poses[0]).toBe(playerB)
    expect(trackedPoseFrameAtTime(frames, intermittentTrack, 300, 120)).toBeUndefined()
  })

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
