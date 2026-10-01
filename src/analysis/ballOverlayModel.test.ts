import { describe, expect, it } from 'vitest'
import {
  BALL_DEFAULT_VISUAL_RADIUS_PX,
  BALL_TRAIL_MAX_POINTS,
  ballFrameAtTime,
  markerRadius,
  resetBallTrail,
  updateBallTrail,
} from './ballOverlayModel'
import type { PrecomputedBallTrack } from './precomputedBallTrack'

const track: PrecomputedBallTrack = {
  schemaVersion: 'precomputed-ball-track.v1',
  sourceSha256: 'a'.repeat(64),
  coordinateSpace: {
    kind: 'intrinsic-source-pixels',
    origin: 'top-left',
    xDirection: 'right',
    yDirection: 'down',
    width: 100,
    height: 100,
  },
  timeline: {
    frameIndexOrigin: 0,
    timestampRule: 'frameIndex * 1000 / sourceFps',
    fps: 10,
    frameCount: 4,
    durationMs: 400,
  },
  frames: [
    { i: 0, t: 0, s: 'observed', x: 10, y: 10, r: 2 },
    { i: 1, t: 100, s: 'observed', x: 12, y: 12 },
    { i: 2, t: 200, s: 'ambiguous' },
    { i: 3, t: 300, s: 'abstained' },
  ],
}

describe('ball overlay synchronization and trail', () => {
  it('selects only the nearest bounded source timestamp', () => {
    expect(ballFrameAtTime(track, 49)?.i).toBe(0)
    expect(ballFrameAtTime(track, 51)?.i).toBe(1)
    expect(ballFrameAtTime(track, 351)).toBeUndefined()
    expect(ballFrameAtTime(track, -1)).toBeUndefined()
  })

  it('adds the visualization margin and clamps source-pixel marker geometry', () => {
    expect(markerRadius(0)).toBe(3)
    expect(markerRadius(10)).toBe(11.5)
    expect(markerRadius(100)).toBe(18)
    expect(markerRadius()).toBe(BALL_DEFAULT_VISUAL_RADIUS_PX)
  })

  it('resets on ambiguous, abstained, missing, backwards, discontinuous, or large-distance input', () => {
    let state = updateBallTrail(resetBallTrail(), track.frames[0], track)
    state = updateBallTrail(state, track.frames[1], track)
    expect(state.points).toHaveLength(2)
    expect(updateBallTrail(state, track.frames[2], track).points).toHaveLength(0)
    expect(updateBallTrail(state, track.frames[3], track).points).toHaveLength(0)
    expect(updateBallTrail(state, undefined, track).points).toHaveLength(0)
    expect(updateBallTrail(state, track.frames[0], track).points).toHaveLength(1)
    expect(updateBallTrail(
      { ...state, lastTimestampMs: -500 },
      track.frames[1],
      track,
    ).points).toHaveLength(1)
    expect(updateBallTrail(
      state,
      { i: 2, t: 200, s: 'observed', x: 100, y: 100 },
      track,
    ).points).toHaveLength(1)
  })

  it('retains the connected trail when multiple presented frames resolve to the same observation', () => {
    let state = updateBallTrail(resetBallTrail(), track.frames[0], track)
    state = updateBallTrail(state, track.frames[1], track)
    const repeated = updateBallTrail(state, track.frames[1], track)

    expect(repeated).toBe(state)
    expect(repeated.points).toHaveLength(2)
    expect(repeated.points.map(({ timestampMs }) => timestampMs)).toEqual([0, 100])
  })

  it('applies a safe configurable point cap without interpolating', () => {
    const longTrack = {
      ...track,
      timeline: { ...track.timeline, fps: 60, frameCount: 60, durationMs: 1000 },
    }
    let state = resetBallTrail()
    for (let index = 0; index < 12; index += 1) {
      state = updateBallTrail(state, {
        i: index,
        t: index * 1000 / 60,
        s: 'observed',
        x: index,
        y: index,
      }, longTrack, { maxPoints: 5 })
    }
    expect(state.points).toHaveLength(5)
    expect(state.points.map(({ x }) => x)).toEqual([7, 8, 9, 10, 11])
  })

  it('bounds the trail to 18 observed points and 650 milliseconds', () => {
    const longTrack = {
      ...track,
      timeline: { ...track.timeline, fps: 60, frameCount: 60, durationMs: 1000 },
    }
    let state = resetBallTrail()
    for (let index = 0; index < 60; index += 1) {
      state = updateBallTrail(state, {
        i: index,
        t: index * 1000 / 60,
        s: 'observed',
        x: index,
        y: index,
      }, longTrack)
    }
    expect(state.points).toHaveLength(BALL_TRAIL_MAX_POINTS)
    expect(state.points.every((point) =>
      (state.lastTimestampMs ?? 0) - point.timestampMs <= 650)).toBe(true)
  })
})
