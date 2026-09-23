import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  analyzePoseFrames,
  runVideoAnalysis,
  type VideoAnalysisOutput,
} from './analysis/videoAnalysisPipeline'
import { loadPrecomputedBallTrack } from './analysis/precomputedBallTrack'

vi.mock('./analysis/videoAnalysisPipeline', async () => {
  const actual = await vi.importActual<typeof import('./analysis/videoAnalysisPipeline')>(
    './analysis/videoAnalysisPipeline',
  )
  return {
    ...actual,
    analyzePoseFrames: vi.fn(actual.analyzePoseFrames),
    runVideoAnalysis: vi.fn(),
  }
})

vi.mock('./analysis/precomputedBallTrack', async () => {
  const actual = await vi.importActual<typeof import('./analysis/precomputedBallTrack')>(
    './analysis/precomputedBallTrack',
  )
  return {
    ...actual,
    loadPrecomputedBallTrack: vi.fn(),
  }
})

const points = Array.from({ length: 33 }, (_, index) => ({
  x: 0.35 + (index % 4) * 0.08,
  y: 0.2 + Math.floor(index / 4) * 0.07,
  visibility: 0.98,
}))
const secondaryPoints = points.map((point) => ({ ...point, x: point.x + 0.3 }))

const analysisOutput = {
  status: 'ready',
  source: { durationMs: 4000, width: 1280, height: 720 },
  sourceHash: 'sha256:test',
  frames: [{ timestampMs: 0, poses: [points] }],
  filteredFrames: [{ timestampMs: 0, poses: [points] }],
  tracking: {
    tracks: [{
      id: 'A',
      poses: [points],
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
    analyzer: 'pose-observations-v2',
    source: 'upload',
    stroke: 'unknown',
    strokeSource: 'unknown',
    strokePresentation: { label: 'unknown motion', provenance: 'unknown' },
    handedness: 'right',
    timing: null,
    inputQuality: 'good',
    poseTrackQuality: 'good',
    segmentationReliability: 'medium',
    observations: [{
      id: 'pelvisProjection',
      label: 'Pelvis projection relative to visible ankle span',
      state: 'present',
      reliability: 'medium',
      evidenceBasis: 'Visible pose landmarks near the movement peak.',
      measuredValue: 0.5,
      unit: 'normalized ankle span',
      description: 'Pelvis projection remained within the visible ankle span.',
    }],
    mainObservation: 'Pelvis projection remained within the visible ankle span.',
    coachingNote: 'Coach label required.',
    moments: [
      { id: 'onset', label: 'Movement onset', timestampMs: 0, note: 'test' },
      { id: 'preparation', label: 'Preparation', timestampMs: 500, note: 'test' },
      { id: 'peak', label: 'Movement peak', timestampMs: 1000, note: 'test' },
      { id: 'offset', label: 'Movement offset', timestampMs: 1500, note: 'test' },
    ],
    peakFrame: 0,
    segment: {
      id: 'movement-1000',
      revision: 1,
      status: 'final',
      source: 'automatic',
      startFrame: 0,
      onsetFrame: 0,
      peakFrame: 0,
      offsetFrame: 0,
      endFrame: 0,
      startMs: 0,
      onsetMs: 0,
      peakMs: 1000,
      offsetMs: 1500,
      endMs: 2000,
      reliability: 'medium',
      poseEvidence: 'high',
      boundaryReliability: 'medium',
      boundaryUncertaintyMs: 50,
      diagnostics: {
        effectiveFps: 30,
        medianIntervalMs: 33.3,
        intervalIqrMs: 0,
        maxGapMs: 34,
        poseCoverage: 1,
        scaleStability: 1,
        eventProminence: 3,
      },
      warnings: [],
      sampledFrameCount: 1,
      effectiveFps: 30,
    },
    trace: [],
    limitations: ['Ball and racket are not tracked.'],
    safety: 'General 2D movement observation only.',
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
const readyAnalysisOutput = analysisOutput as Extract<VideoAnalysisOutput, { status: 'ready' }>

const selectionOutput = {
  status: 'selection-required',
  source: { durationMs: 4000, width: 1280, height: 720 },
  sourceHash: 'sha256:test',
  frames: [
    { timestampMs: 0, poses: [points] },
    { timestampMs: 100, poses: [points, secondaryPoints] },
  ],
  tracking: {
    tracks: [
      {
        id: 'A',
        poses: [points, points],
        persistence: 1,
        coverage: 1,
        averageArea: 0.4,
        averageCenterY: 0.6,
        primaryScore: 0.8,
        warnings: [],
      },
      {
        id: 'B',
        poses: [undefined, secondaryPoints],
        persistence: 1,
        coverage: 1,
        averageArea: 0.39,
        averageCenterY: 0.6,
        primaryScore: 0.79,
        warnings: [],
      },
    ],
    selectionConfidence: 0.2,
    selectionMethod: 'manual-required',
    warnings: ['Near-player scores are close; confirm the player manually.'],
  },
  selectionMethod: 'manual-required',
  cacheStatus: 'miss',
} as unknown as VideoAnalysisOutput

const uploadAndLoadMetadata = () => {
  fireEvent.change(screen.getByLabelText('Upload tennis video'), {
    target: { files: [new File(['demo'], 'demo.mp4', { type: 'video/mp4' })] },
  })
  const engine = screen.getByLabelText('Analysis engine video')
  Object.defineProperties(engine, {
    duration: { configurable: true, value: 4 },
    videoWidth: { configurable: true, value: 1280 },
    videoHeight: { configurable: true, value: 720 },
  })
  fireEvent.loadedMetadata(engine)
}

describe('real local video analysis flow', () => {
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.mocked(runVideoAnalysis).mockResolvedValue(analysisOutput)
    vi.mocked(analyzePoseFrames).mockResolvedValue(readyAnalysisOutput)
    vi.mocked(loadPrecomputedBallTrack).mockResolvedValue({
      status: 'unavailable',
      message: 'Ball visualization is not available for this exact video.',
    })
    createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-video')
    revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  })

  afterEach(() => {
    createObjectUrlSpy.mockRestore()
    revokeObjectUrlSpy.mockRestore()
  })

  it('analyzes the selected file and shows evidence derived from the real pipeline result', async () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Your personal tennis coach' })).toBeInTheDocument()
    uploadAndLoadMetadata()

    expect(screen.getByRole('heading', { name: 'Analyzing your tennis video…' })).toBeInTheDocument()
    expect(screen.getByLabelText('Uploaded tennis video preview')).toHaveAttribute('src', 'blob:test-video')

    expect(await screen.findByRole('heading', { name: 'Your tennis analysis' })).toBeInTheDocument()
    expect(screen.getByLabelText('Analyzed tennis video')).toHaveAttribute('src', 'blob:test-video')
    expect(screen.getByText('Pelvis projection relative to visible ankle span')).toBeInTheDocument()
    expect(screen.queryByText('Prepared sample')).not.toBeInTheDocument()
    expect(runVideoAnalysis).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ball visualization is not available for this exact video.',
    )
    expect(screen.queryByLabelText('Precomputed observed ball overlay')).not.toBeInTheDocument()
  })

  it('does not publish a stale ball result after upload replacement', async () => {
    let resolveFirst: ((value: Awaited<ReturnType<typeof loadPrecomputedBallTrack>>) => void) | undefined
    vi.mocked(loadPrecomputedBallTrack)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({
        status: 'unavailable',
        message: 'Second video has no exact precomputed ball track.',
      })
    render(<App />)
    uploadAndLoadMetadata()
    await screen.findByRole('heading', { name: 'Your tennis analysis' })

    fireEvent.click(screen.getByRole('button', { name: 'Upload another video' }))
    uploadAndLoadMetadata()
    await screen.findByRole('heading', { name: 'Your tennis analysis' })
    resolveFirst?.({
      status: 'unavailable',
      message: 'Stale first-video result.',
    })

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Second video has no exact precomputed ball track.',
    )
    expect(screen.queryByText('Stale first-video result.')).not.toBeInTheDocument()
  })

  it('keeps the uploaded video visible when pose inference fails', async () => {
    vi.mocked(runVideoAnalysis).mockRejectedValueOnce(new Error('The pose model could not process this clip.'))
    render(<App />)
    uploadAndLoadMetadata()

    expect(await screen.findByRole('heading', { name: 'Your video is still available' })).toBeInTheDocument()
    expect(screen.getByLabelText('Uploaded tennis video')).toHaveAttribute('src', 'blob:test-video')
    expect(screen.getByRole('alert')).toHaveTextContent('The pose model could not process this clip.')
  })

  it('requires explicit player choice before publishing ambiguous multi-person feedback', async () => {
    vi.mocked(runVideoAnalysis).mockResolvedValueOnce(selectionOutput)
    render(<App />)
    uploadAndLoadMetadata()

    expect(await screen.findByRole('heading', { name: 'Choose the player to analyze' })).toBeInTheDocument()
    expect(screen.getByText('Player choice required')).toBeInTheDocument()
    expect(screen.queryByText('Pelvis projection relative to visible ankle span')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Tracked player color mapping')).toHaveTextContent('Player A — cyan overlay')
    expect(screen.getByLabelText('Tracked player color mapping')).toHaveTextContent('Player B — magenta overlay')
    expect(screen.getByLabelText('Player A pose overlay')).toBeInTheDocument()
    expect(screen.getByLabelText('Player B pose overlay')).toBeInTheDocument()

    vi.mocked(analyzePoseFrames).mockResolvedValueOnce({
      ...readyAnalysisOutput,
      selectedPlayerId: 'B',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Player B — magenta overlay' }))

    await waitFor(() => {
      expect(analyzePoseFrames).toHaveBeenCalledWith(
        selectionOutput.frames,
        selectionOutput.source,
        'B',
      )
    })
    expect(await screen.findByText(/Player B tracked/)).toBeInTheDocument()
  })

  it('invalidates the active run and shows playback immediately on cancellation', async () => {
    vi.mocked(runVideoAnalysis).mockImplementationOnce(({ signal }) => new Promise((_, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('Analysis cancelled.', 'AbortError')),
        { once: true },
      )
    }))
    render(<App />)
    uploadAndLoadMetadata()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel analysis' }))

    expect(screen.getByRole('heading', { name: 'Your video is still available' })).toBeInTheDocument()
    expect(screen.getByLabelText('Uploaded tennis video')).toHaveAttribute('src', 'blob:test-video')
  })

  it('reports a browser decode failure without hiding the selected video', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Upload tennis video'), {
      target: { files: [new File(['invalid'], 'broken.mov', { type: 'video/quicktime' })] },
    })

    fireEvent.error(screen.getByLabelText('Analysis engine video'))

    expect(await screen.findByRole('heading', { name: 'Your video is still available' })).toBeInTheDocument()
    expect(screen.getByLabelText('Uploaded tennis video')).toHaveAttribute('src', 'blob:test-video')
    expect(screen.getByRole('alert')).toHaveTextContent('could not decode')
  })

  it('returns to upload and revokes the object URL', async () => {
    render(<App />)
    uploadAndLoadMetadata()
    await screen.findByRole('heading', { name: 'Your tennis analysis' })

    fireEvent.click(screen.getByRole('button', { name: 'Upload another video' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your personal tennis coach' })).toBeInTheDocument())
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-video')
  })

  it('aborts work and revokes the object URL on unmount', () => {
    const { unmount } = render(<App />)
    fireEvent.change(screen.getByLabelText('Upload tennis video'), {
      target: { files: [new File(['demo'], 'demo.mp4', { type: 'video/mp4' })] },
    })

    unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-video')
  })
})
