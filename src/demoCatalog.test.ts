import { describe, expect, it } from 'vitest'
import { demoCatalog } from './demoCatalog'

describe('demoCatalog', () => {
  it('covers all supported strokes and an unsupported case', () => {
    expect(new Set(demoCatalog.map((clip) => clip.id)).size).toBe(demoCatalog.length)
    expect(new Set(demoCatalog.map((clip) => clip.expectedStroke))).toEqual(
      new Set(['forehand', 'backhand', 'serve', 'unclear']),
    )
    expect(demoCatalog.some((clip) => clip.expectation === 'unverified')).toBe(true)
    expect(demoCatalog.filter((clip) => clip.id.startsWith('kaggle-backview-video-'))).toHaveLength(10)
    expect(demoCatalog.filter((clip) => clip.catalogGroup === 'guided-fixture').map((clip) => clip.id)).toEqual([
      'guided-cc0-backview-movement',
      'forehand-outdoor',
      'backhand-indoor',
      'serve-portrait',
      'multiple-people',
    ])
    expect(demoCatalog.filter((clip) => clip.catalogGroup === 'evaluation-lab')).toHaveLength(10)
  })

  it('has complete provenance and deterministic windows', () => {
    for (const clip of demoCatalog) {
      expect(clip.asset).toMatch(/^\/samples\/.+\.mp4$/)
      expect(clip.sourceUrl).toMatch(/^https:\/\/www\.(pexels|kaggle)\.com\//)
      expect(clip.directUrl).toMatch(/^https:\/\/(videos\.pexels|www\.kaggle)\.com\//)
      expect(['Pexels License', 'CC0: Public Domain']).toContain(clip.licenseName)
      expect(clip.creator).not.toHaveLength(0)
      if (clip.analysisWindow) {
        expect(clip.analysisWindow.end - clip.analysisWindow.start).toBeGreaterThanOrEqual(1.5)
      }
    }
  })

})
