import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  Download,
  RotateCcw,
  Settings,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { analysisCache, sha256Blob } from './analysis/analysisCache'
import type { BallTrackingResult } from './analysis/ballTracking'
import {
  getLocalBallProviderConfig,
  observationsToBallTrack,
  runLocalBallProvider,
} from './analysis/localBallProvider'
import type { OverlayToggles } from './analysis/compositeRenderer'
import {
  clearPrecomputedBallTrackCache,
  loadPrecomputedBallTrack,
  type PrecomputedBallTrack,
} from './analysis/precomputedBallTrack'
import { generateShotInsight, type ShotInsight } from './analysis/shotInsight'
import { shotSegmentsWithBallEvidence } from './analysis/shotSegments'
import {
  createPipelineStages,
  stageReducer,
  type PipelineStages,
} from './analysis/stageCoordinator'
import type { PoseFrame } from './analysis/types'
import {
  runVideoAnalysis,
  type VideoAnalysisOutput,
} from './analysis/videoAnalysisPipeline'
import {
  canExportCombinedVideo,
  exportCombinedVideo,
} from './analysis/videoExport'
import { PoseViewer } from './components/PoseViewer'
import { ShotInsightPanel } from './components/ShotInsightPanel'
import { ShotList } from './components/ShotSegments'

const MAX_FILE_BYTES = 200 * 1024 * 1024
const MAX_DURATION_SECONDS = 30

interface SourceMetadata {
  width: number
  height: number
  durationMs: number
}

interface BallStageResult {
  track?: PrecomputedBallTrack
  provider: 'exact-hash cache' | 'local provider'
  tracking?: BallTrackingResult
}

type Stages = PipelineStages<
  PoseFrame[],
  VideoAnalysisOutput,
  PrecomputedBallTrack,
  BallStageResult
>

const initialStages = createPipelineStages<
  PoseFrame[],
  VideoAnalysisOutput,
  PrecomputedBallTrack,
  BallStageResult
>()

const errorMessage = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Cancelled. The selected video remains playable.'
  if (error instanceof Error) return error.message
  return 'This stage could not finish. The selected video remains playable.'
}

const stageLabel = (status: Stages['pose']['status']) => ({
  queued: 'Queued',
  loading: 'Loading',
  running: 'Running',
  ready: 'Ready',
  unavailable: 'Unavailable',
  failed: 'Failed',
  cancelled: 'Cancelled',
}[status])

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const poseVideoRef = useRef<HTMLVideoElement>(null)
  const playbackVideoRef = useRef<HTMLVideoElement | null>(null)
  const exportCanvasRef = useRef<HTMLCanvasElement>(null)
  const poseControllerRef = useRef<AbortController | undefined>(undefined)
  const ballControllerRef = useRef<AbortController | undefined>(undefined)
  const exportControllerRef = useRef<AbortController | undefined>(undefined)
  const insightControllerRef = useRef<AbortController | undefined>(undefined)
  const insightRetryControllerRef = useRef<AbortController | undefined>(undefined)
  const sourceControllerRef = useRef<AbortController | undefined>(undefined)
  const sourceHashPromiseRef = useRef<Promise<string> | undefined>(undefined)
  const insightCacheRef = useRef(new Map<string, ShotInsight>())
  const objectUrlRef = useRef<string | undefined>(undefined)
  const startedRunRef = useRef<number | undefined>(undefined)
  const runIdRef = useRef(0)

  const [selectedFile, setSelectedFile] = useState<File>()
  const [videoUrl, setVideoUrl] = useState<string>()
  const [source, setSource] = useState<SourceMetadata>()
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cacheMessage, setCacheMessage] = useState<string>()
  const [toggles, setToggles] = useState<OverlayToggles>({
    body: true,
    ball: true,
    coaching: true,
  })
  const [stages, dispatch] = useReducer(stageReducer, initialStages)
  const [selectedInsightSegmentId, setSelectedInsightSegmentId] = useState<string>()
  const [shotInsightStates, setShotInsightStates] = useState<Record<string, {
    status: 'queued' | 'loading' | 'ready' | 'error'
    insight?: ShotInsight
    message?: string
  }>>({})
  const [exportProgress, setExportProgress] = useState<number>()
  const [exportError, setExportError] = useState<string>()

  const stopWork = (revokeUrl: boolean) => {
    poseControllerRef.current?.abort()
    ballControllerRef.current?.abort()
    exportControllerRef.current?.abort()
    insightControllerRef.current?.abort()
    insightRetryControllerRef.current?.abort()
    sourceControllerRef.current?.abort()
    poseControllerRef.current = undefined
    ballControllerRef.current = undefined
    exportControllerRef.current = undefined
    insightControllerRef.current = undefined
    insightRetryControllerRef.current = undefined
    sourceControllerRef.current = undefined
    sourceHashPromiseRef.current = undefined
    startedRunRef.current = undefined
    runIdRef.current += 1
    if (revokeUrl && objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = undefined
    }
  }

  useEffect(() => () => stopWork(true), [])

  const runPoseStage = async (
    runId: number,
    file: File,
    video: HTMLVideoElement,
    sourceHashPromise: Promise<string>,
  ) => {
    poseControllerRef.current?.abort()
    const controller = new AbortController()
    poseControllerRef.current = controller
    dispatch({
      type: 'update-pose',
      runId,
      patch: { status: 'loading', progress: 0, message: 'Loading pose analysis…' },
    })
    try {
      const sourceHash = await sourceHashPromise
      if (controller.signal.aborted) throw new DOMException('Analysis cancelled.', 'AbortError')
      const result = await runVideoAnalysis({
        file,
        video,
        signal: controller.signal,
        sourceHash,
        onProgress: (progress) => dispatch({
          type: 'update-pose',
          runId,
          patch: {
            status: progress.stage === 'loading-model' ? 'loading' : 'running',
            progress: progress.value,
            message: progress.message,
          },
        }),
        onBatch: (frames) => dispatch({
          type: 'update-pose',
          runId,
          patch: {
            status: 'running',
            partialResult: frames,
            processedFrames: frames.length,
            message: `Body pose: ${frames.length} frames processed.`,
          },
        }),
      })
      dispatch({
        type: 'update-pose',
        runId,
        patch: {
          status: 'ready',
          progress: 1,
          message: result.cacheStatus === 'hit'
            ? 'Body pose ready from local derived cache.'
            : 'Body pose and coaching analysis ready.',
          processedFrames: result.frames.length,
          partialResult: result.filteredFrames,
          result,
          cacheReuse: result.cacheStatus === 'hit',
        },
      })
    } catch (error) {
      dispatch({
        type: 'update-pose',
        runId,
        patch: {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          message: errorMessage(error),
        },
      })
    }
  }

  const runBallStage = async (
    runId: number,
    file: File,
    metadata: SourceMetadata,
    sourceHashPromise: Promise<string>,
  ) => {
    ballControllerRef.current?.abort()
    const controller = new AbortController()
    ballControllerRef.current = controller
    dispatch({
      type: 'update-ball',
      runId,
      patch: { status: 'loading', progress: 0, message: 'Checking exact-hash ball cache…' },
    })
    try {
      const sourceHash = await sourceHashPromise
      if (controller.signal.aborted) throw new DOMException('Ball tracking cancelled.', 'AbortError')
      const cached = await loadPrecomputedBallTrack({
        source: {
          sha256: sourceHash.replace(/^sha256:/, ''),
          bytes: file.size,
          durationMs: metadata.durationMs,
          width: metadata.width,
          height: metadata.height,
        },
        signal: controller.signal,
      })
      if (cached.status === 'available') {
        dispatch({
          type: 'update-ball',
          runId,
          patch: {
            status: 'ready',
            progress: 1,
            message: 'Ball tracking ready from exact-hash precomputed cache.',
            processedFrames: cached.track.timeline.frameCount,
            partialResult: cached.track,
            result: { track: cached.track, provider: 'exact-hash cache' },
            cacheReuse: true,
          },
        })
        return
      }

      const endpoint = getLocalBallProviderConfig().endpoint
      if (!endpoint) {
        dispatch({
          type: 'update-ball',
          runId,
          patch: {
            status: 'unavailable',
            progress: 1,
            message: 'No exact-hash track exists and no private local ball provider is configured.',
          },
        })
        return
      }
      dispatch({
        type: 'update-ball',
        runId,
        patch: { status: 'running', progress: 0, message: 'Running configured local ball provider…' },
      })
      const tracking = await runLocalBallProvider({
        file,
        runId: `ball-${runId}`,
        sourceSha256: sourceHash.replace(/^sha256:/, ''),
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
        signal: controller.signal,
        endpoint,
        onUpdate: ({ progress, track }) => dispatch({
          type: 'update-ball',
          runId,
          patch: {
            status: 'running',
            progress: progress.estimatedTotalFrames
              ? Math.min(0.99, progress.processedFrames / progress.estimatedTotalFrames)
              : 0,
            message: `Ball tracking: ${progress.processedFrames}${progress.estimatedTotalFrames ? ` / ${progress.estimatedTotalFrames}` : ''} frames.`,
            processedFrames: progress.processedFrames,
            estimatedTotalFrames: progress.estimatedTotalFrames,
            partialResult: track,
          },
        }),
      })
      if (!tracking) return
      const track = observationsToBallTrack({
        sourceSha256: sourceHash.replace(/^sha256:/, ''),
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
        fps: tracking.source.fps,
        observations: tracking.observations,
      })
      dispatch({
        type: 'update-ball',
        runId,
        patch: {
          status: tracking.status === 'cancelled'
            ? 'cancelled'
            : tracking.status === 'unavailable' || !track
              ? 'unavailable'
              : 'ready',
          progress: 1,
          message: tracking.status === 'unavailable'
            ? tracking.abstentionReason ?? 'The local provider returned no usable ball evidence.'
            : 'Ball tracking ready from the configured local provider.',
          processedFrames: tracking.metrics.processedFrames,
          estimatedTotalFrames: tracking.metrics.expectedFrames,
          partialResult: track,
          result: { track, provider: 'local provider', tracking },
        },
      })
    } catch (error) {
      dispatch({
        type: 'update-ball',
        runId,
        patch: {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          message: errorMessage(error),
        },
      })
    }
  }

  const startStages = (video: HTMLVideoElement) => {
    if (!selectedFile || !videoUrl || startedRunRef.current === runIdRef.current) return
    const metadata = {
      durationMs: Math.round(video.duration * 1000),
      width: video.videoWidth,
      height: video.videoHeight,
    }
    setSource(metadata)
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      const runId = runIdRef.current
      dispatch({ type: 'update-pose', runId, patch: { status: 'failed', message: 'The video duration could not be read.' } })
      dispatch({ type: 'update-ball', runId, patch: { status: 'failed', message: 'The video duration could not be read.' } })
      return
    }
    if (video.duration > MAX_DURATION_SECONDS) {
      const message = `Choose a clip up to ${MAX_DURATION_SECONDS} seconds.`
      const runId = runIdRef.current
      dispatch({ type: 'update-pose', runId, patch: { status: 'unavailable', message } })
      dispatch({ type: 'update-ball', runId, patch: { status: 'unavailable', message } })
      return
    }
    const runId = runIdRef.current
    startedRunRef.current = runId
    const sourceController = new AbortController()
    sourceControllerRef.current = sourceController
    const sourceHashPromise = sha256Blob(selectedFile, sourceController.signal)
    sourceHashPromiseRef.current = sourceHashPromise
    void runPoseStage(runId, selectedFile, video, sourceHashPromise)
    void runBallStage(runId, selectedFile, metadata, sourceHashPromise)
  }

  const handleUpload = (file?: File) => {
    if (!file) return
    stopWork(true)
    if (!file.size || file.size > MAX_FILE_BYTES || typeof URL.createObjectURL !== 'function') {
      return
    }
    const runId = runIdRef.current
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setSelectedFile(file)
    setVideoUrl(url)
    setSource(undefined)
    setCurrentTimeMs(0)
    setSelectedInsightSegmentId(undefined)
    setShotInsightStates({})
    setExportError(undefined)
    setExportProgress(undefined)
    dispatch({
      type: 'reset',
      runId,
      poseMessage: 'Waiting for source metadata…',
      ballMessage: 'Waiting for source metadata…',
    })
  }

  const restart = () => {
    stopWork(true)
    setSelectedFile(undefined)
    setVideoUrl(undefined)
    setSource(undefined)
    setSelectedInsightSegmentId(undefined)
    setShotInsightStates({})
    setExportProgress(undefined)
    setExportError(undefined)
    insightCacheRef.current.clear()
    if (inputRef.current) inputRef.current.value = ''
  }

  const retryPose = () => {
    const video = poseVideoRef.current
    if (!video || !selectedFile) return
    const sourceHashPromise = sourceHashPromiseRef.current
      ?? sha256Blob(selectedFile, sourceControllerRef.current?.signal)
    sourceHashPromiseRef.current = sourceHashPromise
    void runPoseStage(runIdRef.current, selectedFile, video, sourceHashPromise)
  }

  const retryBall = () => {
    if (!selectedFile || !source) return
    const sourceHashPromise = sourceHashPromiseRef.current
      ?? sha256Blob(selectedFile, sourceControllerRef.current?.signal)
    sourceHashPromiseRef.current = sourceHashPromise
    void runBallStage(runIdRef.current, selectedFile, source, sourceHashPromise)
  }

  const poseOutput = stages.pose.result
  const poseFrames = poseOutput?.filteredFrames ?? stages.pose.partialResult ?? []
  const ballTrack = stages.ball.result?.track ?? stages.ball.partialResult
  const enabledHorizons = [
    toggles.body ? poseFrames.at(-1)?.timestampMs ?? 0 : undefined,
    toggles.ball ? ballTrack?.frames.at(-1)?.t ?? 0 : undefined,
    toggles.coaching ? (poseOutput ? source?.durationMs ?? 0 : 0) : undefined,
  ].filter((value): value is number => value !== undefined)
  const analyzedHorizonMs = enabledHorizons.length ? Math.min(...enabledHorizons) : undefined
  const shotSegments = useMemo(
    () => shotSegmentsWithBallEvidence(poseOutput?.segments ?? [], ballTrack),
    [ballTrack, poseOutput?.segments],
  )

  useEffect(() => {
    if (!videoUrl || !poseOutput || !shotSegments.length) return
    insightControllerRef.current?.abort()
    const controller = new AbortController()
    insightControllerRef.current = controller
    setShotInsightStates(Object.fromEntries(
      shotSegments.map((segment) => [segment.id, { status: 'queued' as const }]),
    ))
    void (async () => {
      for (const segment of shotSegments) {
        if (controller.signal.aborted) return
        const cacheKey = `${poseOutput.sourceHash}:${segment.id}:${segment.onsetMs}:${segment.offsetMs}`
        const cached = insightCacheRef.current.get(cacheKey)
        if (cached) {
          setShotInsightStates((states) => ({
            ...states,
            [segment.id]: { status: 'ready', insight: cached },
          }))
          continue
        }
        setShotInsightStates((states) => ({ ...states, [segment.id]: { status: 'loading' } }))
        try {
          const insight = await generateShotInsight(videoUrl, segment, controller.signal)
          insightCacheRef.current.set(cacheKey, insight)
          setShotInsightStates((states) => ({
            ...states,
            [segment.id]: { status: 'ready', insight },
          }))
        } catch (error) {
          if (!controller.signal.aborted) {
            setShotInsightStates((states) => ({
              ...states,
              [segment.id]: { status: 'error', message: errorMessage(error) },
            }))
          }
        }
      }
    })()
    return () => controller.abort()
  }, [poseOutput, shotSegments, videoUrl])

  const seekToTimestamp = (timestampMs: number, pause = false) => {
    const video = playbackVideoRef.current
    if (!video) return
    if (pause) video.pause()
    video.currentTime = timestampMs / 1000
    setCurrentTimeMs(timestampMs)
  }

  const selectShot = (segment: (typeof shotSegments)[number]) => {
    seekToTimestamp(segment.onsetMs)
    setSelectedInsightSegmentId(segment.id)
  }

  const exportReady =
    (!toggles.body || stages.pose.status === 'ready')
    && (!toggles.coaching || stages.pose.status === 'ready')
    && (!toggles.ball || stages.ball.status === 'ready')
    && (toggles.body || toggles.ball || toggles.coaching)

  const downloadCombinedVideo = async () => {
    const canvas = exportCanvasRef.current
    if (!canvas || !source || !videoUrl || !exportReady) return
    exportControllerRef.current?.abort()
    const controller = new AbortController()
    exportControllerRef.current = controller
    const video = document.createElement('video')
    video.className = 'analysis-engine-video'
    video.playsInline = true
    video.preload = 'auto'
    video.src = videoUrl
    document.body.append(video)
    setExportError(undefined)
    setExportProgress(0)
    try {
      video.src = videoUrl
      video.load()
      const poseFps = poseFrames.length > 1
        ? 1000 / Math.max(1, (poseFrames.at(-1)!.timestampMs - poseFrames[0].timestampMs) / (poseFrames.length - 1))
        : 30
      const { blob } = await exportCombinedVideo({
        video,
        canvas,
        overlay: {
          sourceWidth: source.width,
          sourceHeight: source.height,
          poseFrames,
          ballTrack,
          analysis: poseOutput?.result,
          toggles,
          playerLabel: poseOutput ? `Player ${poseOutput.selectedPlayerId}` : undefined,
        },
        fps: ballTrack?.timeline.fps ?? poseFps,
        signal: controller.signal,
        onProgress: setExportProgress,
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'tenniscoach-combined-annotated.webm'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setExportError(errorMessage(error))
    } finally {
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.remove()
      setExportProgress(undefined)
      exportControllerRef.current = undefined
    }
  }

  const clearCache = async () => {
    try {
      await analysisCache.clear()
      clearPrecomputedBallTrackCache()
      setCacheMessage('Local derived analysis cache cleared.')
    } catch {
      setCacheMessage('The local cache could not be cleared.')
    }
  }

  const stageRow = (
    name: 'Body pose' | 'Ball tracking',
    stage: Stages['pose'] | Stages['ball'],
    onCancel: () => void,
    onRetry: () => void,
  ) => (
    <div className="stage-row">
      <div>
        <strong>{name}</strong>
        <span className={`stage-pill stage-pill--${stage.status}`}>{stageLabel(stage.status)}</span>
        {stage.cacheReuse && <span className="cache-pill">cache reused</span>}
      </div>
      <progress value={stage.progress} max={1} aria-label={`${name} progress`} />
      <p>
        {stage.message}
        {stage.processedFrames !== undefined && (
          <> · {stage.processedFrames}{stage.estimatedTotalFrames ? ` / ${stage.estimatedTotalFrames}` : ''} frames</>
        )}
      </p>
      <div className="stage-actions">
        {['loading', 'running'].includes(stage.status) && (
          <button type="button" onClick={onCancel}>Cancel</button>
        )}
        {['failed', 'cancelled', 'unavailable'].includes(stage.status) && (
          <button type="button" onClick={onRetry}>Retry</button>
        )}
      </div>
    </div>
  )

  return (
    <main className="app-shell">
      <div className="topbar">
        <header className="brand" aria-label="TennisCoach.AI">
          <span className="brand-mark"><Video size={20} aria-hidden="true" /></span>
          <span>TennisCoach.AI</span>
        </header>
        {videoUrl && (
          <button
            type="button"
            className="settings-button"
            aria-label="Analysis settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            {settingsOpen ? <X size={20} /> : <Settings size={20} />}
          </button>
        )}
        {settingsOpen && (
          <aside className="settings-panel" aria-label="Analysis settings panel">
            <strong>Analysis settings</strong>
            <p>Pose and ball run independently. Local ball inference is used only when explicitly configured.</p>
            <button type="button" className="text-button" onClick={() => void clearCache()}>
              Clear local analysis cache
            </button>
            {cacheMessage && <small role="status">{cacheMessage}</small>}
          </aside>
        )}
      </div>

      {!videoUrl ? (
        <section className="upload-view" aria-labelledby="hero-title">
          <h1 id="hero-title">Your personal tennis coach</h1>
          <p className="hero-copy">
            Choose a short tennis clip. Playback starts immediately while body and ball evidence process independently.
          </p>
          <label className="upload-card">
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              aria-label="Upload tennis video"
              onChange={(event) => handleUpload(event.target.files?.[0])}
            />
            <span className="upload-icon"><Upload size={30} aria-hidden="true" /></span>
            <strong>Upload your tennis video</strong>
            <span>MP4, MOV or WebM · up to 30 seconds</span>
          </label>
        </section>
      ) : (
        <section className="result-view review-view" aria-labelledby="analysis-title">
          <p className="eyebrow">PROGRESSIVE LOCAL REVIEW</p>
          <h1 id="analysis-title">Review while analysis runs</h1>
          <p className="result-copy">The player stays usable; inference never seeks this visible video.</p>

          <PoseViewer
            videoUrl={videoUrl}
            frames={poseFrames}
            label="Progressive tennis review"
            intrinsicWidth={source?.width ?? 16}
            intrinsicHeight={source?.height ?? 9}
            onVideoRef={(video) => { playbackVideoRef.current = video }}
            onTimeUpdate={setCurrentTimeMs}
            primaryPlayerLabel={poseOutput ? `Player ${poseOutput.selectedPlayerId}` : undefined}
            ballTrack={ballTrack}
            showBadge={false}
            shotSegments={shotSegments}
            currentTimeMs={currentTimeMs}
            shotPlayerLabel={poseOutput ? `Player ${poseOutput.selectedPlayerId}` : undefined}
            onShotSelect={selectShot}
            toggles={toggles}
            analysis={poseOutput?.result}
            analyzedHorizonMs={analyzedHorizonMs}
          />

          <fieldset className="overlay-toggles">
            <legend>Overlays</legend>
            {([
              ['body', 'Body'],
              ['ball', 'Ball'],
              ['coaching', 'Coaching labels'],
            ] as const).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={toggles[key]}
                  onChange={(event) => setToggles((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))}
                />
                {label}
              </label>
            ))}
          </fieldset>

          <section className="stage-list" aria-label="Analysis stages">
            {stageRow(
              'Body pose',
              stages.pose,
              () => poseControllerRef.current?.abort(),
              retryPose,
            )}
            {stageRow(
              'Ball tracking',
              stages.ball,
              () => ballControllerRef.current?.abort(),
              retryBall,
            )}
          </section>

          {poseOutput && (
            <>
              <ShotList
                segments={shotSegments}
                currentTimeMs={currentTimeMs}
                onSelect={selectShot}
                playerLabel={`Player ${poseOutput.selectedPlayerId}`}
                insightStates={Object.fromEntries(
                  Object.entries(shotInsightStates).map(([id, state]) => [id, state.status]),
                )}
              />
              <ShotInsightPanel
                state={selectedInsightSegmentId
                  ? shotInsightStates[selectedInsightSegmentId] ?? { status: 'queued' }
                  : undefined}
                onTimestampSelect={(timestamp) => {
                  const seconds = Number(timestamp.replace(/s$/, ''))
                  if (Number.isFinite(seconds)) seekToTimestamp(seconds * 1000, true)
                }}
                onRetry={() => {
                  const segment = shotSegments.find(({ id }) => id === selectedInsightSegmentId)
                  if (!segment || !videoUrl) return
                  insightRetryControllerRef.current?.abort()
                  const retryController = new AbortController()
                  insightRetryControllerRef.current = retryController
                  const retryRunId = runIdRef.current
                  setShotInsightStates((states) => ({ ...states, [segment.id]: { status: 'loading' } }))
                  void generateShotInsight(videoUrl, segment, retryController.signal)
                    .then((insight) => {
                      if (retryController.signal.aborted || retryRunId !== runIdRef.current) return
                      setShotInsightStates((states) => ({
                        ...states,
                        [segment.id]: { status: 'ready', insight },
                      }))
                    })
                    .catch((error) => {
                      if (retryController.signal.aborted || retryRunId !== runIdRef.current) return
                      setShotInsightStates((states) => ({
                        ...states,
                        [segment.id]: { status: 'error', message: errorMessage(error) },
                      }))
                    })
                }}
              />
            </>
          )}

          <section className="export-panel" aria-label="Annotated video export">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void downloadCombinedVideo()}
              disabled={!exportReady || exportProgress !== undefined || !canExportCombinedVideo()}
            >
              <Download size={18} />
              {exportProgress !== undefined
                ? `Exporting WebM… ${Math.round(exportProgress * 100)}%`
                : 'Download enabled overlays (.webm)'}
            </button>
            <small>
              Includes original source audio when the browser exposes it. Export uses a separate hidden video and never interrupts review playback.
            </small>
            {!exportReady && <p>Turn off unfinished overlays or wait until their stage is ready.</p>}
            {exportError && <p className="inline-error" role="alert">{exportError}</p>}
          </section>

          <button className="restart-button" type="button" onClick={restart}>
            <RotateCcw size={18} aria-hidden="true" />
            Upload another video
          </button>

          <video
            ref={poseVideoRef}
            className="analysis-engine-video"
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            aria-label="Pose analysis engine video"
            onLoadedMetadata={(event) => startStages(event.currentTarget)}
            onError={() => {
              const runId = runIdRef.current
              dispatch({ type: 'update-pose', runId, patch: { status: 'failed', message: 'This browser could not decode the selected video.' } })
              dispatch({ type: 'update-ball', runId, patch: { status: 'failed', message: 'This browser could not decode the selected video.' } })
            }}
          />
          <canvas ref={exportCanvasRef} className="analysis-engine-video" aria-hidden="true" />
        </section>
      )}
    </main>
  )
}
