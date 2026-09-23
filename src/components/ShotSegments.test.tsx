import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PrecomputedBallTrack } from '../analysis/precomputedBallTrack'
import { shotSegmentsWithBallEvidence } from '../analysis/shotSegments'
import type { StrokeSegment } from '../analysis/types'
import {
  ShotList,
  ShotProgressRail,
} from './ShotSegments'

const segment = (id: string, startMs: number, endMs: number): StrokeSegment => ({
  id,
  revision: 1,
  status: 'final',
  source: 'automatic',
  startFrame: 0,
  onsetFrame: 0,
  peakFrame: 1,
  offsetFrame: 2,
  endFrame: 2,
  startMs,
  onsetMs: startMs,
  peakMs: (startMs + endMs) / 2,
  offsetMs: endMs,
  endMs,
  reliability: 'medium',
  poseEvidence: 'high',
  boundaryReliability: 'medium',
  boundaryUncertaintyMs: 20,
  diagnostics: {
    effectiveFps: 6,
    medianIntervalMs: 166,
    intervalIqrMs: 0,
    maxGapMs: 166,
    poseCoverage: 1,
    scaleStability: 1,
    eventProminence: 2,
  },
  warnings: [],
})

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
    frameCount: 4,
    durationMs: 400,
  },
  frames: [
    { i: 0, t: 0, s: 'abstained' },
    { i: 1, t: 100, s: 'observed', x: 20, y: 20 },
    { i: 2, t: 200, s: 'observed', x: 22, y: 20 },
    { i: 3, t: 300, s: 'abstained' },
  ],
}

describe('shot navigation', () => {
  it('shows only pose segments that overlap observed ball evidence', () => {
    expect(shotSegmentsWithBallEvidence([
      segment('before', 0, 50),
      segment('shot', 80, 220),
      segment('after', 250, 350),
    ], track).map(({ id }) => id)).toEqual(['shot'])
    expect(shotSegmentsWithBallEvidence([segment('shot', 80, 220)])).toEqual([])
  })

  it('consolidates overlapping fallback windows into separated navigation ranges', () => {
    const extendedTrack = {
      ...track,
      timeline: { ...track.timeline, frameCount: 10, durationMs: 1000 },
      frames: Array.from({ length: 10 }, (_, index) => ({
        i: index,
        t: index * 100,
        s: 'observed' as const,
        x: 20,
        y: 20,
      })),
    }
    expect(shotSegmentsWithBallEvidence([
      segment('first', 0, 220),
      segment('follow-through', 120, 320),
      segment('second', 350, 560),
      segment('second-recovery', 460, 650),
      segment('third', 700, 900),
    ], extendedTrack).map(({ id }) => id)).toEqual(['first', 'second', 'third'])
  })

  it('renders timeline segments and a clickable shot list', () => {
    const onSelect = vi.fn()
    const segments = [segment('shot-1', 100, 200)]
    render(
      <>
        <ShotProgressRail
          segments={segments}
          durationMs={400}
          currentTimeMs={150}
          onSelect={onSelect}
          playerLabel="Player A"
        />
        <ShotList
          segments={segments}
          currentTimeMs={150}
          onSelect={onSelect}
          playerLabel="Player A"
        />
      </>,
    )

    expect(screen.getByLabelText('Player A shot segments on video timeline')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Player A shots' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Shot 1, 0:00.1 to 0:00.2/ })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /^Shot 1/ })[1])
    expect(onSelect).toHaveBeenCalledWith(segments[0])
  })
})
