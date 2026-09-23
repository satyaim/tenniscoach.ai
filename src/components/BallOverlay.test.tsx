import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrecomputedBallTrack } from '../analysis/precomputedBallTrack'
import { BallOverlay } from './BallOverlay'

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  lineCap: '',
  lineJoin: '',
  lineWidth: 0,
  strokeStyle: '',
  fillStyle: '',
}

const track: PrecomputedBallTrack = {
  schemaVersion: 'precomputed-ball-track.v1',
  sourceSha256: 'a'.repeat(64),
  coordinateSpace: {
    kind: 'intrinsic-source-pixels',
    origin: 'top-left',
    xDirection: 'right',
    yDirection: 'down',
    width: 100,
    height: 50,
  },
  timeline: {
    frameIndexOrigin: 0,
    timestampRule: 'frameIndex * 1000 / sourceFps',
    fps: 10,
    frameCount: 2,
    durationMs: 200,
  },
  frames: [
    { i: 0, t: 0, s: 'observed', x: 25, y: 20, r: 4 },
    { i: 1, t: 100, s: 'ambiguous' },
  ],
}

describe('BallOverlay', () => {
  afterEach(() => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    vi.clearAllMocks()
  })

  it('draws an intrinsic-coordinate marker only for observed frames', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext)
      .mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      top: 0,
      right: 200,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    })

    const view = render(<BallOverlay track={track} timestampMs={0} resetToken={0} />)
    expect(context.arc).toHaveBeenCalledWith(50, 40, 11, 0, Math.PI * 2)

    context.arc.mockClear()
    view.rerender(<BallOverlay track={track} timestampMs={100} resetToken={0} />)
    expect(context.arc).not.toHaveBeenCalled()
    expect(context.clearRect).toHaveBeenCalled()
  })
})

