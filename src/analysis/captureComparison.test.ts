import { describe, expect, it } from 'vitest'
import type { AnalysisResult } from './types'
import { captureComparisonKey } from './captureComparison'

const chapter = (overrides: Partial<AnalysisResult['captureContext']> = {}, effectiveFps = 30.1) => ({
  analyzer: 'pose-observations-v2',
  source: 'demo',
  stroke: 'backhand',
  handedness: 'right',
  playerSelection: { selectedPlayerId: 'A' },
  captureContext: {
    viewpoint: 'fixed rear',
    cameraMotion: 'fixed',
    cuts: 'none',
    resolution: '1920x1080',
    sourceFps: 30.06,
    samplingConfig: 'source-aware-max-30hz-v1',
    normalizationGeometry: 'shoulder-width-2d-v1',
    ...overrides,
  },
  segment: { diagnostics: { effectiveFps } },
}) as unknown as AnalysisResult

describe('captureComparisonKey', () => {
  it('keeps compatible chapters comparable despite harmless measured-FPS jitter', () => {
    expect(captureComparisonKey(chapter({}, 30.01))).toBe(captureComparisonKey(chapter({}, 30.42)))
  })

  it.each([
    ['viewpoint', { viewpoint: 'side' }],
    ['camera motion', { cameraMotion: 'moving' as const }],
    ['cuts', { cuts: 'present' as const }],
    ['resolution', { resolution: '1280x720' }],
    ['source FPS', { sourceFps: 60 }],
    ['sampling configuration', { samplingConfig: 'different' }],
    ['normalization geometry', { normalizationGeometry: 'different' as never }],
  ])('excludes chapters with incompatible %s', (_, overrides) => {
    expect(captureComparisonKey(chapter(overrides))).not.toBe(captureComparisonKey(chapter()))
  })

  it('separates descriptor-rate eligible and ineligible chapters', () => {
    expect(captureComparisonKey(chapter({}, 29.9))).not.toBe(captureComparisonKey(chapter({}, 30)))
  })
})
