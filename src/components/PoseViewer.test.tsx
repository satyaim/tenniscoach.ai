import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ballTrailTrackIdentity } from '../analysis/ballOverlayModel'
import type { PrecomputedBallTrack } from '../analysis/precomputedBallTrack'
import { PoseViewer } from './PoseViewer'

describe('PoseViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback')
    Reflect.deleteProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback')
  })

  it('drives overlay time from each presented video frame', () => {
    let presentedFrame: VideoFrameRequestCallback | undefined
    const requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      presentedFrame = callback
      return 17
    })
    const cancelVideoFrameCallback = vi.fn()
    Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', {
      configurable: true,
      value: requestVideoFrameCallback,
    })
    Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', {
      configurable: true,
      value: cancelVideoFrameCallback,
    })
    const onTimeUpdate = vi.fn()

    const view = render(
      <PoseViewer
        videoUrl="blob:test-video"
        label="Local pose overlay"
        intrinsicWidth={1920}
        intrinsicHeight={1080}
        onTimeUpdate={onTimeUpdate}
      />,
    )

    expect(requestVideoFrameCallback).toHaveBeenCalledOnce()
    act(() => {
      presentedFrame?.(0, { mediaTime: 1.25 } as VideoFrameCallbackMetadata)
    })
    expect(onTimeUpdate).toHaveBeenCalledWith(1250)
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(2)

    view.unmount()
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(17)
  })

  it('constrains portrait video height without changing its aspect ratio', () => {
    render(
      <PoseViewer
        videoUrl="blob:portrait-video"
        label="Portrait analysis"
        intrinsicWidth={1080}
        intrinsicHeight={1920}
      />,
    )

    expect(screen.getByLabelText('Pose visualization: Portrait analysis')).toHaveStyle({
      aspectRatio: '0.5625',
      width: 'min(100%, 38.25vh, 427.5px)',
    })
  })

  it('keeps one trail identity across progressive and final versions of the same track', () => {
    const partial: PrecomputedBallTrack = {
      schemaVersion: 'precomputed-ball-track.v1',
      sourceSha256: 'a'.repeat(64),
      coordinateSpace: {
        kind: 'intrinsic-source-pixels',
        origin: 'top-left',
        xDirection: 'right',
        yDirection: 'down',
        width: 1280,
        height: 720,
      },
      timeline: {
        frameIndexOrigin: 0,
        timestampRule: 'frameIndex * 1000 / sourceFps',
        fps: 30,
        frameCount: 2,
        durationMs: 66.67,
      },
      frames: [
        { i: 0, t: 0, s: 'observed', x: 10, y: 20 },
        { i: 1, t: 33.33, s: 'observed', x: 12, y: 21 },
      ],
    }
    const final = {
      ...partial,
      timeline: { ...partial.timeline, frameCount: 3, durationMs: 100 },
      frames: [
        ...partial.frames,
        { i: 2, t: 66.67, s: 'observed' as const, x: 14, y: 22 },
      ],
    }

    expect(ballTrailTrackIdentity(final)).toBe(ballTrailTrackIdentity(partial))
  })
})
