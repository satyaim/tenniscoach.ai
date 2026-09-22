import { describe, expect, it } from 'vitest'
import {
  BALL_TRACK_SCHEMA_VERSION,
  isBallTrackingResult,
  unavailableBallTrackingResult,
  type BallTrackingResult,
} from './ballTracking'

const source = {
  kind: 'ordinary-rgb-video' as const,
  width: 1280,
  height: 720,
  durationMs: 5000,
  fps: 60,
  frameCount: 300,
}

describe('ball tracking adapter contract', () => {
  it('creates a versioned, explicit abstention without requiring runtime metadata', () => {
    const result = unavailableBallTrackingResult(
      'ball-run-1',
      source,
      'Official checkpoints are not installed in quarantine.',
    )

    expect(result).toMatchObject({
      schemaVersion: BALL_TRACK_SCHEMA_VERSION,
      status: 'unavailable',
      observations: [],
      inpaintedPoints: [],
      frames: [],
      abstentionReason: 'Official checkpoints are not installed in quarantine.',
    })
    expect(result.limitations.join(' ')).toMatch(/no ball position/i)
    expect(result.limitations.join(' ')).toMatch(/no learned checkpoint/i)
    expect(isBallTrackingResult(result)).toBe(true)
  })

  it('preserves detector observations separately from learned repair points', () => {
    const result: BallTrackingResult = {
      ...unavailableBallTrackingResult('ball-run-2', { ...source, frameCount: 2 }, 'fixture'),
      status: 'partial',
      observations: [{
        id: 'obs-0',
        frameIndex: 0,
        timestampMs: 0,
        center: { x: 10, y: 20 },
        evidenceQuality: 'usable',
        status: 'visible',
        provenance: 'learned-observation',
        limitations: [],
      }, {
        id: 'obs-1',
        frameIndex: 1,
        timestampMs: 1000 / 60,
        evidenceQuality: 'insufficient',
        status: 'occluded',
        provenance: 'none',
        limitations: ['No direct heatmap localization.'],
      }],
      inpaintedPoints: [{
        id: 'repair-1',
        frameIndex: 1,
        timestampMs: 1000 / 60,
        center: { x: 11, y: 21 },
        status: 'model-inferred',
        provenance: 'learned-trajectory',
        sourceGap: { startFrame: 1, endFrame: 1, lengthFrames: 1 },
        limitations: ['Badminton-domain transfer output.'],
      }],
      frames: [{
        frameIndex: 0,
        timestampMs: 0,
        state: 'visible',
        provenance: 'learned-observation',
        observationId: 'obs-0',
      }, {
        frameIndex: 1,
        timestampMs: 1000 / 60,
        state: 'occluded',
        provenance: 'learned-trajectory',
        observationId: 'obs-1',
        inpaintedPointId: 'repair-1',
      }],
      metrics: {
        ...unavailableBallTrackingResult('metrics', { ...source, frameCount: 2 }, 'fixture').metrics,
        expectedFrames: 2,
        processedFrames: 2,
        accountedFrames: 2,
      },
      failures: [],
    }

    expect(isBallTrackingResult(result)).toBe(true)
    expect(result.observations[1].center).toBeUndefined()
    expect(result.inpaintedPoints[0].provenance).toBe('learned-trajectory')
  })

  it('rejects duplicate or incomplete source-frame accounting', () => {
    const result = unavailableBallTrackingResult('bad-frames', { ...source, frameCount: 2 }, 'fixture')
    result.status = 'partial'
    result.frames = [
      { frameIndex: 0, timestampMs: 0, state: 'absent', provenance: 'none' },
      { frameIndex: 0, timestampMs: 0, state: 'absent', provenance: 'none' },
    ]
    result.metrics.accountedFrames = 2

    expect(isBallTrackingResult(result)).toBe(false)
  })

  it('rejects unversioned or non-video payloads', () => {
    expect(isBallTrackingResult({ status: 'complete', observations: [], tracks: [] })).toBe(false)
    expect(isBallTrackingResult({
      schemaVersion: BALL_TRACK_SCHEMA_VERSION,
      runId: 'bad-source',
      status: 'complete',
      source: { kind: 'manual-csv', fps: 60 },
      observations: [],
      inpaintedPoints: [],
      frames: [],
      tracks: [],
      failures: [],
      limitations: [],
    })).toBe(false)
  })
})
