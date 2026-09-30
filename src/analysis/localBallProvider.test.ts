import { describe, expect, it } from 'vitest'
import { observationsToBallTrack } from './localBallProvider'

describe('local ball provider evidence conversion', () => {
  it('keeps only direct observations and never interpolates gaps', () => {
    const track = observationsToBallTrack({
      sourceSha256: 'a'.repeat(64),
      width: 1280,
      height: 720,
      durationMs: 1000,
      fps: 10,
      observations: [
        {
          id: 'visible-0',
          frameIndex: 0,
          timestampMs: 0,
          center: { x: 100, y: 200 },
          evidenceQuality: 'usable',
          status: 'visible',
          provenance: 'learned-observation',
          limitations: [],
        },
        {
          id: 'ambiguous-2',
          frameIndex: 2,
          timestampMs: 200,
          evidenceQuality: 'limited',
          status: 'ambiguous',
          provenance: 'none',
          limitations: [],
        },
      ],
    })

    expect(track?.frames).toEqual([
      expect.objectContaining({ i: 0, s: 'observed', x: 100, y: 200 }),
      { i: 1, t: 100, s: 'abstained' },
      { i: 2, t: 200, s: 'ambiguous' },
    ])
  })

  it('rejects frame indexes outside the declared source timeline', () => {
    expect(() => observationsToBallTrack({
      sourceSha256: 'a'.repeat(64),
      width: 1280,
      height: 720,
      durationMs: 1000,
      fps: 30,
      observations: [{
        id: 'bad',
        frameIndex: 1_000_000,
        timestampMs: 0,
        center: { x: 100, y: 200 },
        evidenceQuality: 'usable',
        status: 'visible',
        provenance: 'learned-observation',
        limitations: [],
      }],
    })).toThrow('declared source timeline')
  })
})
