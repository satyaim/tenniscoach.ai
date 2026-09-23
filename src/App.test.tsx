import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  runVideoAnalysis,
  type VideoAnalysisOutput,
} from './analysis/videoAnalysisPipeline'
import {
  loadPrecomputedBallTrack,
  type PrecomputedBallTrack,
} from './analysis/precomputedBallTrack'
import { generateShotInsight } from './analysis/shotInsight'

vi.mock('./analysis/videoAnalysisPipeline', async () => {
  const actual = await vi.importActual<typeof import('./analysis/videoAnalysisPipeline')>(
    './analysis/videoAnalysisPipeline',
  )
  return {
    ...actual,
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

vi.mock('./analysis/shotInsight', async () => {
  const actual = await vi.importActual<typeof import('./analysis/shotInsight')>(
    './analysis/shotInsight',
  )
  return {
    ...actual,
    generateShotInsight: vi.fn(),
  }
})

const points = Array.from({ length: 33 }, (_, index) => ({
  x: 0.35 + (index % 4) * 0.08,
  y: 0.2 + Math.floor(index / 4) * 0.07,
  visibility: 0.98,
}))

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
const shotSegment = {
  ...readyAnalysisOutput.result.segment,
  id: 'shot-segment-1',
  startMs: 500,
  onsetMs: 650,
  peakMs: 1000,
  offsetMs: 1350,
  endMs: 1500,
}
const analysisWithShot = {
  ...readyAnalysisOutput,
  segments: [shotSegment],
}
const observedBallTrack: PrecomputedBallTrack = {
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
    frameCount: 4,
    durationMs: 2000,
  },
  frames: [
    { i: 0, t: 0, s: 'abstained' },
    { i: 1, t: 500, s: 'observed', x: 600, y: 300 },
    { i: 2, t: 1000, s: 'observed', x: 620, y: 290 },
    { i: 3, t: 1500, s: 'abstained' },
  ],
}

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
    vi.mocked(generateShotInsight).mockResolvedValue({
      visualFacts: [{
        fact: 'The knees are slightly bent.',
        evidenceTimestamps: ['0.65s', '1.00s'],
        confidence: 'medium',
      }],
      coachRecommendation: {
        focusArea: 'Footwork base',
        assessment: 'The stance narrows near the end of the sequence.',
        whyItMatters: 'A repeatable base can make the next movement easier to organize.',
        actionCue: 'Finish with enough space between your feet to move either direction.',
        drill: {
          name: 'Hit, recover, freeze',
          steps: ['Shadow the movement.', 'Recover to a stable base.', 'Freeze for one second.'],
          volume: '2 sets of 8 repetitions',
          successCheck: 'Feet finish apart and the head stays between them.',
        },
        evidenceTimestamps: ['0.65s', '1.00s'],
        confidence: 'medium',
      },
      withheld: [],
    })
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
    expect(screen.queryByText('Pelvis projection relative to visible ankle span')).not.toBeInTheDocument()
    expect(screen.queryByText('Local pose overlay')).not.toBeInTheDocument()
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

  it('shows clickable shot segments only when pose and observed ball evidence overlap', async () => {
    vi.mocked(runVideoAnalysis).mockResolvedValueOnce(analysisWithShot)
    vi.mocked(loadPrecomputedBallTrack).mockResolvedValueOnce({
      status: 'available',
      track: observedBallTrack,
      entry: {} as never,
      cacheIdentity: 'ball-cache-test',
      message: 'Precomputed ball observations are available for this exact video.',
    })
    render(<App />)
    uploadAndLoadMetadata()

    expect(await screen.findByRole('heading', { name: 'Player A shots' })).toBeInTheDocument()
    expect(screen.getByLabelText('Player A shot segments on video timeline')).toBeInTheDocument()
    const shotButtons = screen.getAllByRole('button', { name: /^Shot 1/ })
    fireEvent.click(shotButtons[1])
    expect(screen.getByLabelText('Analyzed tennis video')).toHaveProperty('currentTime', 0.65)
    expect(await screen.findByRole('heading', { name: 'TennisCoach.AI insights' })).toBeInTheDocument()
    expect(screen.getByText('The knees are slightly bent.')).toBeInTheDocument()
    expect(generateShotInsight).toHaveBeenCalledWith(
      'blob:test-video',
      shotSegment,
      expect.any(AbortSignal),
    )
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause')
    fireEvent.click(screen.getAllByRole('button', { name: '1.00s' })[0])
    expect(screen.getByLabelText('Analyzed tennis video')).toHaveProperty('currentTime', 1)
    expect(pauseSpy).toHaveBeenCalled()
    pauseSpy.mockRestore()
    fireEvent.click(shotButtons[1])
    expect(generateShotInsight).toHaveBeenCalledTimes(1)
  })

  it('offers a friendly retry when Azure coaching generation fails', async () => {
    vi.mocked(runVideoAnalysis).mockResolvedValueOnce(analysisWithShot)
    vi.mocked(loadPrecomputedBallTrack).mockResolvedValueOnce({
      status: 'available',
      track: observedBallTrack,
      entry: {} as never,
      cacheIdentity: 'ball-cache-test',
      message: 'Precomputed ball observations are available for this exact video.',
    })
    vi.mocked(generateShotInsight)
      .mockRejectedValueOnce(new Error('Azure produced an unsupported coaching recommendation.'))
      .mockResolvedValueOnce({
        visualFacts: [],
        coachRecommendation: null,
        withheld: ['No grounded coaching recommendation was available.'],
      })
    render(<App />)
    uploadAndLoadMetadata()

    const shotButton = (await screen.findAllByRole('button', { name: /^Shot 1/ }))[1]
    fireEvent.click(shotButton)
    expect(await screen.findByText(/Something went wrong while creating grounded coaching cues/i))
      .toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate cues' }))
    await waitFor(() => expect(generateShotInsight).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/unsupported coaching recommendation/i)).not.toBeInTheDocument()
  })

  it('keeps the uploaded video visible when pose inference fails', async () => {
    vi.mocked(runVideoAnalysis).mockRejectedValueOnce(new Error('The pose model could not process this clip.'))
    render(<App />)
    uploadAndLoadMetadata()

    expect(await screen.findByRole('heading', { name: 'Your video is still available' })).toBeInTheDocument()
    expect(screen.getByLabelText('Uploaded tennis video')).toHaveAttribute('src', 'blob:test-video')
    expect(screen.getByRole('alert')).toHaveTextContent('The pose model could not process this clip.')
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
