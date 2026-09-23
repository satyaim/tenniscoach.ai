import { describe, expect, it } from 'vitest'
import { demoFrames } from './demoFixture'
import { segmentStrokes } from './strokeSegmenter'
import type { StrokeSegment } from './types'

describe('rule-based stroke candidate segmenter', () => {
  it('can segment movement without requiring a handedness choice', () => {
    const segments = segmentStrokes(demoFrames, 'auto')
    expect(segments.length).toBeGreaterThan(0)
    expect(segments.every((segment) => segment.id.startsWith('movement-'))).toBe(true)
  })

  it('finds individual movement candidates rather than returning the full clip', () => {
    const first = demoFrames.map((frame) => ({ ...frame }))
    const second = demoFrames.map((frame) => ({
      ...frame,
      timestampMs: frame.timestampMs + demoFrames.at(-1)!.timestampMs + 1200,
    }))
    const segments = segmentStrokes([...first, ...second], 'right')

    expect(segments.length).toBeGreaterThanOrEqual(2)
    expect(segments.every((segment) => segment.endFrame - segment.startFrame < first.length + second.length - 1)).toBe(true)
    expect(segments.every((segment) => segment.startMs < segment.peakMs && segment.peakMs < segment.endMs)).toBe(true)
  })

  it('keeps playback review available when there is no clean movement peak', () => {
    const still = demoFrames.map((frame) => ({ ...frame, poses: [demoFrames[0].poses[0]] }))
    const segments = segmentStrokes(still, 'right')
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      status: 'provisional',
      reliability: 'insufficient',
    })
    expect(segments[0].warnings.join(' ')).toMatch(/no distinct movement peak/i)
  })

  it.each([1, 2, 5, 12, 30, demoFrames.length])(
    'converges to the same deterministic chapters with progressive batch size %s',
    (batchSize) => {
      let observed: StrokeSegment[] = []
      for (let end = batchSize; end < demoFrames.length; end += batchSize) {
        observed = segmentStrokes(demoFrames.slice(0, end), 'right')
      }
      observed = segmentStrokes(demoFrames, 'right')
      expect(observed).toEqual(segmentStrokes(demoFrames, 'right'))
      expect(observed.every((segment) => segment.revision === 1)).toBe(true)
    },
  )

  it('does not mutate an existing finalized chapter when a later movement is appended', () => {
    const first = demoFrames.map((frame) => ({ ...frame }))
    const firstSegments = segmentStrokes(first, 'right')
    const second = demoFrames.map((frame) => ({
      ...frame,
      timestampMs: frame.timestampMs + demoFrames.at(-1)!.timestampMs + 1200,
    }))
    const combined = segmentStrokes([...first, ...second], 'right')

    for (const finalized of firstSegments.filter((segment) => segment.status === 'final')) {
      expect(combined.find((segment) => segment.id === finalized.id)).toEqual(finalized)
    }
  })
})
