import type { AnalysisResult } from './types'

export const captureComparisonKey = (chapter: AnalysisResult) => [
  chapter.playerSelection?.selectedPlayerId ?? 'single',
  chapter.handedness,
  chapter.stroke,
  chapter.source,
  chapter.analyzer,
  chapter.captureContext.viewpoint,
  chapter.captureContext.cameraMotion,
  chapter.captureContext.cuts,
  chapter.captureContext.resolution,
  chapter.captureContext.sourceFps?.toFixed(2) ?? 'unknown-source-fps',
  chapter.captureContext.samplingConfig,
  chapter.captureContext.normalizationGeometry,
  chapter.segment.diagnostics.effectiveFps >= 30 ? 'descriptor-rate-eligible' : 'descriptor-rate-ineligible',
].join(':')
