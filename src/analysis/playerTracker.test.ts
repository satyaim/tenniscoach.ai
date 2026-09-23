import { describe, expect, it } from 'vitest'
import { demoFrames } from './demoFixture'
import { filterFramesForTrack, trackPlayers } from './playerTracker'
import type { PoseLandmark } from './types'

const transform = (pose: PoseLandmark[], scale: number, offsetX: number, offsetY: number) =>
  pose.map((point) => ({
    ...point,
    x: 0.5 + (point.x - 0.5) * scale + offsetX,
    y: 0.5 + (point.y - 0.5) * scale + offsetY,
  }))

describe('player tracking and selection', () => {
  it('keeps stable identities when MediaPipe pose order swaps', () => {
    const frames = demoFrames.slice(0, 20).map((frame, index) => {
      const near = transform(frame.poses[0], 1, -0.14, 0.08)
      const far = transform(frame.poses[0], 0.48, 0.2, -0.18)
      return { ...frame, poses: index % 2 ? [far, near] : [near, far] }
    })
    const tracking = trackPlayers(frames)

    expect(tracking.tracks).toHaveLength(2)
    expect(tracking.recommendedPlayerId).toBe('A')
    expect(tracking.warnings.join(' ')).toMatch(/order changed/i)
    const selected = filterFramesForTrack(frames, tracking.tracks.find((track) => track.id === 'A')!)
    expect(selected.every((frame) => frame.poses.length === 1)).toBe(true)
    expect(selected[0].poses[0][11].x).toBeCloseTo(selected[1].poses[0][11].x, 2)
  })

  it('prefers the larger lower-image persistent player', () => {
    const frames = demoFrames.slice(0, 20).map((frame) => ({
      ...frame,
      poses: [
        transform(frame.poses[0], 0.5, 0.18, -0.18),
        transform(frame.poses[0], 1, -0.12, 0.1),
      ],
    }))
    const tracking = trackPlayers(frames)
    const recommended = tracking.tracks.find((track) => track.id === tracking.recommendedPlayerId)!
    expect(recommended.averageArea).toBeGreaterThan(tracking.tracks.find((track) => track.id !== recommended.id)!.averageArea)
  })

  it('tolerates short gaps and still selects one primary track for near-ties', () => {
    const frames = demoFrames.slice(0, 20).map((frame, index) => ({
      ...frame,
      poses:
        index === 8 || index === 9
          ? [transform(frame.poses[0], 0.8, -0.1, 0)]
          : [
              transform(frame.poses[0], 0.8, -0.1, 0),
              transform(frame.poses[0], 0.79, 0.1, 0),
            ],
    }))
    const tracking = trackPlayers(frames)
    expect(tracking.tracks[0].persistence).toBeGreaterThan(0.85)
    expect(tracking.selectionMethod).toBe('auto-near')
    expect(tracking.recommendedPlayerId).toBe(tracking.tracks[0].id)
    expect(tracking.warnings.join(' ')).toMatch(/secondary pose detections were ignored/i)
  })
})
