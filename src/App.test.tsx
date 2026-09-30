import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { loadPrecomputedBallTrack } from './analysis/precomputedBallTrack'
import {
  runVideoAnalysis,
  type VideoAnalysisOutput,
} from './analysis/videoAnalysisPipeline'

vi.mock('./analysis/videoAnalysisPipeline', async () => {
  const actual = await vi.importActual<typeof import('./analysis/videoAnalysisPipeline')>(
    './analysis/videoAnalysisPipeline',
  )
  return { ...actual, runVideoAnalysis: vi.fn() }
})

vi.mock('./analysis/precomputedBallTrack', async () => {
  const actual = await vi.importActual<typeof import('./analysis/precomputedBallTrack')>(
    './analysis/precomputedBallTrack',
  )
  return { ...actual, loadPrecomputedBallTrack: vi.fn() }
})

const points = Array.from({ length: 33 }, (_, index) => ({
  x: 0.35 + (index % 4) * 0.08,
  y: 0.2 + Math.floor(index / 4) * 0.07,
  visibility: 0.98,
}))

const frames = [
  { timestampMs: 0, poses: [points] },
  { timestampMs: 500, poses: [points] },
]

const output = {
  status: 'ready',
  source: { durationMs: 4000, width: 1280, height: 720 },
  sourceHash: 'sha256:test',
  frames,
  filteredFrames: frames,
  tracking: {
    tracks: [{
      id: 'A',
      poses: frames.map((item) => item.poses[0]),
      persistence: 1,
      coverage: 1,
      averageArea: 0.4,
      averageCenterY: 0.6,
      primaryScore: 1,
      warnings: [],
    }],
    recommendedPlayerId: 'A',
    selectionConfidence: 0.95,
    selectionMethod: 'auto-near',
    warnings: [],
  },
  selectedPlayerId: 'A',
  segments: [],
  cacheStatus: 'miss',
  result: {
    analyzer: 'test',
    source: 'upload',
    stroke: 'unknown',
    strokeSource: 'unknown',
    strokePresentation: { label: 'unknown motion', provenance: 'unknown' },
    handedness: 'unknown',
    timing: null,
    inputQuality: 'good',
    poseTrackQuality: 'good',
    segmentationReliability: 'medium',
    observations: [],
    mainObservation: 'Visible body movement.',
    coachingNote: 'Review visible evidence.',
    moments: [
      { id: 'onset', label: 'Movement onset', timestampMs: 0, note: 'test' },
      { id: 'preparation', label: 'Preparation', timestampMs: 200, note: 'test' },
      { id: 'peak', label: 'Movement peak', timestampMs: 300, note: 'test' },
      { id: 'offset', label: 'Movement offset', timestampMs: 500, note: 'test' },
    ],
    peakFrame: 1,
    segment: {
      id: 'movement-1',
      revision: 1,
      status: 'final',
      source: 'automatic',
      startFrame: 0,
      onsetFrame: 0,
      peakFrame: 1,
      offsetFrame: 1,
      endFrame: 1,
      startMs: 0,
      onsetMs: 0,
      peakMs: 300,
      offsetMs: 500,
      endMs: 500,
      reliability: 'medium',
      poseEvidence: 'high',
      boundaryReliability: 'medium',
      boundaryUncertaintyMs: 50,
      diagnostics: {
        effectiveFps: 2,
        medianIntervalMs: 500,
        intervalIqrMs: 0,
        maxGapMs: 500,
        poseCoverage: 1,
        scaleStability: 1,
        eventProminence: 2,
      },
      warnings: [],
      sampledFrameCount: 2,
      effectiveFps: 2,
    },
    trace: [],
    limitations: [],
    safety: 'test',
    captureContext: {
      viewpoint: 'uploaded',
      cameraMotion: 'unknown',
      cuts: 'unknown',
      resolution: '1280x720',
      samplingConfig: 'test',
      normalizationGeometry: 'shoulder-width-2d-v1',
    },
  },
} as unknown as VideoAnalysisOutput

const upload = () => {
  fireEvent.change(screen.getByLabelText('Upload tennis video'), {
    target: { files: [new File(['demo'], 'demo.mp4', { type: 'video/mp4' })] },
  })
}

const loadMetadata = () => {
  const engine = screen.getByLabelText('Pose analysis engine video')
  Object.defineProperties(engine, {
    duration: { configurable: true, value: 4 },
    videoWidth: { configurable: true, value: 1280 },
    videoHeight: { configurable: true, value: 720 },
  })
  fireEvent.loadedMetadata(engine)
}

describe('progressive pose and ball review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-video')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.mocked(runVideoAnalysis).mockResolvedValue(output)
    vi.mocked(loadPrecomputedBallTrack).mockResolvedValue({
      status: 'unavailable',
      message: 'No exact track.',
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('shows a playable source immediately and starts independent stages after metadata', async () => {
    render(<App />)
    upload()

    expect(screen.getByRole('heading', { name: 'Review while analysis runs' })).toBeInTheDocument()
    expect(screen.getByLabelText('Analyzed tennis video')).toHaveAttribute('src', 'blob:test-video')
    expect(runVideoAnalysis).not.toHaveBeenCalled()

    loadMetadata()
    await waitFor(() => expect(runVideoAnalysis).toHaveBeenCalledOnce())
    await waitFor(() => expect(loadPrecomputedBallTrack).toHaveBeenCalledOnce())
    expect(await screen.findByText(/Body pose and coaching analysis ready/)).toBeInTheDocument()
    expect(screen.getByText(/no private local ball provider is configured/i)).toBeInTheDocument()
  })

  it('publishes pose batches before finalization', async () => {
    let finish: ((value: VideoAnalysisOutput) => void) | undefined
    vi.mocked(runVideoAnalysis).mockImplementationOnce(({ onBatch }) => {
      onBatch?.(frames)
      return new Promise((resolve) => { finish = resolve })
    })
    render(<App />)
    upload()
    loadMetadata()

    expect(await screen.findByText(/Body pose: 2 frames processed/)).toBeInTheDocument()
    expect(screen.getByLabelText('Body, ball, and coaching overlay')).toBeInTheDocument()

    await act(async () => finish?.(output))
    expect(await screen.findByText(/Body pose and coaching analysis ready/)).toBeInTheDocument()
  })

  it('keeps ball completion visible when pose fails', async () => {
    vi.mocked(runVideoAnalysis).mockRejectedValueOnce(new Error('Pose failed.'))
    vi.mocked(loadPrecomputedBallTrack).mockResolvedValueOnce({
      status: 'available',
      track: {
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
          fps: 2,
          frameCount: 1,
          durationMs: 4000,
        },
        frames: [{ i: 0, t: 0, s: 'observed', x: 500, y: 300 }],
      },
      entry: {} as never,
      cacheIdentity: 'test',
      message: 'available',
    })
    render(<App />)
    upload()
    loadMetadata()

    expect(await screen.findByText('Pose failed.')).toBeInTheDocument()
    expect(await screen.findByText(/Ball tracking ready from exact-hash precomputed cache/)).toBeInTheDocument()
    expect(screen.getByLabelText('Analyzed tennis video')).toBeInTheDocument()
  })

  it('cancels one stage without removing playback or the other stage', async () => {
    vi.mocked(runVideoAnalysis).mockImplementationOnce(({ signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
    }))
    render(<App />)
    upload()
    loadMetadata()

    const cancelButtons = await screen.findAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButtons[0])
    expect(await screen.findByText('Cancelled. The selected video remains playable.')).toBeInTheDocument()
    expect(screen.getByText(/no private local ball provider is configured/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Analyzed tennis video')).toBeInTheDocument()
  })

  it('revokes the object URL on restart and unmount', () => {
    const view = render(<App />)
    upload()
    fireEvent.click(screen.getByRole('button', { name: 'Upload another video' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-video')
    upload()
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
