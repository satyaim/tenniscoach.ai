import { describe, expect, it } from 'vitest'
import { demoFrames } from './demoFixture'
import { SegmentRevisionStore } from './segmentRevisionStore'
import { segmentStrokes } from './strokeSegmenter'

describe('SegmentRevisionStore', () => {
  it.each([1, 2, 5, 12, 30, demoFrames.length])(
    'preserves intermediate revisions for progressive batch size %s',
    (batchSize) => {
      const store = new SegmentRevisionStore()
      for (let end = batchSize; end <= demoFrames.length; end += batchSize) {
        store.reconcile(segmentStrokes(demoFrames.slice(0, end), 'right'))
      }
      store.reconcile(segmentStrokes(demoFrames, 'right'))

      const history = store.revisionHistory()
      expect(history.length).toBeGreaterThan(0)
      expect(history.every((item) =>
        item.revisions.every((revision, index) => revision.revision === index + 1))).toBe(true)
      if (batchSize < demoFrames.length) {
        expect(history.some((item) => item.revisions.length > 1)).toBe(true)
      }
    },
  )

  it('keeps the first emitted final chapter immutable after later frames arrive', () => {
    const store = new SegmentRevisionStore()
    const first = store.reconcile(segmentStrokes(demoFrames, 'right')).find((segment) => segment.status === 'final')
    expect(first).toBeDefined()
    const later = demoFrames.map((frame) => ({
      ...frame,
      timestampMs: frame.timestampMs + demoFrames.at(-1)!.timestampMs + 1200,
    }))
    store.reconcile(segmentStrokes([...demoFrames, ...later], 'right'))

    expect(store.current().find((segment) => segment.id === first!.id)).toEqual(first)
    expect(store.revisionHistory().find((item) => item.id === first!.id)?.revisions).toEqual([first])
  })
})
