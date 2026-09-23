import { describe, expect, it } from 'vitest'
import { demoDurationMs, demoFrames } from './demoFixture'
import { analyzePoseFrames, isPoseFrameArtifact } from './videoAnalysisPipeline'
import type { PoseLandmark } from './types'

const transform = (pose: PoseLandmark[], scale: number, offsetX: number) =>
  pose.map((point) => ({
    ...point,
    x: 0.5 + (point.x - 0.5) * scale + offsetX,
  }))

describe('uploaded video analysis pipeline', () => {
  it('accepts complete JSON pose artifacts and rejects malformed cache payloads', () => {
    expect(isPoseFrameArtifact(demoFrames)).toBe(true)
    expect(isPoseFrameArtifact([])).toBe(false)
    expect(isPoseFrameArtifact([{ timestampMs: 0, poses: [[{ x: Number.NaN, y: 0 }]] }])).toBe(false)
  })

  it('auto-selects a player while keeping stroke identity unavailable', async () => {
    const output = await analyzePoseFrames(demoFrames, {
      durationMs: demoDurationMs,
      width: 1280,
      height: 720,
    })

    expect(output.status).toBe('ready')
    if (output.status !== 'ready') throw new Error('Expected completed analysis.')
    expect(output.selectedPlayerId).toBe('A')
    expect(output.result.stroke).toBe('unknown')
    expect(output.result.strokePresentation.provenance).toBe('unknown')
    expect(output.result.playerSelection?.selectionMethod).toBe('auto-near')
    expect(output.filteredFrames.every((frame) => frame.poses.length <= 1)).toBe(true)
  })

  it('analyzes only the strongest primary track when multiple poses are detected', async () => {
    const ambiguous = demoFrames.map((frame) => ({
      ...frame,
      poses: [
        transform(frame.poses[0], 0.8, -0.1),
        transform(frame.poses[0], 0.79, 0.1),
      ],
    }))
    const output = await analyzePoseFrames(ambiguous, {
      durationMs: demoDurationMs,
      width: 1280,
      height: 720,
    })

    expect(output.status).toBe('ready')
    expect(output.selectedPlayerId).toBe('A')
    expect(output.filteredFrames.every((frame) => frame.poses.length <= 1)).toBe(true)
    expect(output.result.playerSelection?.selectionMethod).toBe('auto-near')
    expect(output.tracking.warnings.join(' ')).toMatch(/secondary pose detections were ignored/i)
  })
})
