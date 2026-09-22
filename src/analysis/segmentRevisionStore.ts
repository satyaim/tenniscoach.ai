import type { StrokeSegment } from './types'

const comparable = (segment: StrokeSegment) => JSON.stringify({ ...segment, revision: 0 })

const overlapMs = (left: StrokeSegment, right: StrokeSegment) =>
  Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs))

export class SegmentRevisionStore {
  private currentSegments: StrokeSegment[] = []
  private readonly histories = new Map<string, StrokeSegment[]>()

  reset() {
    this.currentSegments = []
    this.histories.clear()
  }

  reconcile(incoming: StrokeSegment[]) {
    const unmatched = new Set(this.currentSegments)
    const next: StrokeSegment[] = []

    for (const candidate of [...incoming].sort((left, right) => left.peakMs - right.peakMs)) {
      const exact = this.currentSegments.find((segment) => unmatched.has(segment) && segment.id === candidate.id)
      const overlapping = [...unmatched]
        .map((segment) => ({ segment, overlap: overlapMs(segment, candidate) }))
        .filter((item) => item.overlap > 0)
        .sort((left, right) =>
          right.overlap - left.overlap ||
          Math.abs(left.segment.peakMs - candidate.peakMs) - Math.abs(right.segment.peakMs - candidate.peakMs))[0]?.segment
      const previous = exact ?? overlapping

      if (previous) unmatched.delete(previous)
      if (previous?.status === 'final') {
        next.push(previous)
        continue
      }

      const normalized = {
        ...candidate,
        id: previous?.id ?? candidate.id,
        revision: previous ? previous.revision + (comparable(previous) === comparable({ ...candidate, id: previous.id }) ? 0 : 1) : 1,
      }
      next.push(normalized)
      const history = this.histories.get(normalized.id) ?? []
      if (!history.length || history.at(-1)!.revision !== normalized.revision) {
        this.histories.set(normalized.id, [...history, normalized])
      }
    }

    for (const previous of unmatched) {
      if (previous.status === 'final') next.push(previous)
    }
    this.currentSegments = next.sort((left, right) => left.peakMs - right.peakMs)
    return this.current()
  }

  current() {
    return this.currentSegments.map((segment) => ({ ...segment }))
  }

  revisionHistory() {
    return [...this.histories.entries()]
      .map(([id, revisions]) => ({ id, revisions: revisions.map((segment) => ({ ...segment })) }))
      .sort((left, right) => left.revisions[0].peakMs - right.revisions[0].peakMs)
  }
}
