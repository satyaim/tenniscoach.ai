import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  RotateCcw,
  Settings,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { analysisCache } from './analysis/analysisCache'
import {
  clearPrecomputedBallTrackCache,
  loadPrecomputedBallTrack,
  type BallTrackLoadResult,
} from './analysis/precomputedBallTrack'
import { shotSegmentsWithBallEvidence } from './analysis/shotSegments'
import { poseFrameAtTime, trackedPoseFrameAtTime } from './analysis/overlayModel'
import {
  analyzePoseFrames,
  runVideoAnalysis,
  type CompletedVideoAnalysisOutput,
  type VideoAnalysisOutput,
  type VideoAnalysisProgress,
} from './analysis/videoAnalysisPipeline'
import { PoseViewer } from './components/PoseViewer'
import { ShotList } from './components/ShotSegments'

type Screen = 'upload' | 'processing' | 'analysis'

const MAX_FILE_BYTES = 200 * 1024 * 1024
const MAX_DURATION_SECONDS = 30

const errorMessage = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Analysis cancelled. Your video is still available.'
  if (error instanceof Error) return error.message
  return 'The local analysis could not finish. Your video is still available.'
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const analysisVideoRef = useRef<HTMLVideoElement>(null)
  const playbackVideoRef = useRef<HTMLVideoElement | null>(null)
  const controllerRef = useRef<AbortController | undefined>(undefined)
  const objectUrlRef = useRef<string | undefined>(undefined)
  const startedUrlRef = useRef<string | undefined>(undefined)
  const runIdRef = useRef(0)

  const [screen, setScreen] = useState<Screen>('upload')
  const [selectedFile, setSelectedFile] = useState<File>()
  const [videoUrl, setVideoUrl] = useState<string>()
  const [progress, setProgress] = useState<VideoAnalysisProgress>({
    stage: 'preparing',
    value: 0,
    message: 'Preparing your video…',
  })
  const [output, setOutput] = useState<VideoAnalysisOutput>()
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [sourceAspectRatio, setSourceAspectRatio] = useState(16 / 9)
  const [error, setError] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cacheMessage, setCacheMessage] = useState<string>()
  const [ballTrackResult, setBallTrackResult] = useState<BallTrackLoadResult>()
  const [ballMessage, setBallMessage] = useState<string>()

  const releaseRun = (revokeUrl: boolean) => {
    controllerRef.current?.abort()
    controllerRef.current = undefined
    runIdRef.current += 1
    startedUrlRef.current = undefined
    if (revokeUrl && objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = undefined
    }
  }

  useEffect(() => () => releaseRun(true), [])

  const beginAnalysis = async (video: HTMLVideoElement) => {
    if (!selectedFile || !videoUrl) return
    const file = selectedFile
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      setError('The video duration could not be read. Try MP4, WebM, or MOV.')
      setScreen('analysis')
      return
    }
    if (video.duration > MAX_DURATION_SECONDS) {
      setError(`For this POC, choose a clip up to ${MAX_DURATION_SECONDS} seconds.`)
      setScreen('analysis')
      return
    }

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const runId = ++runIdRef.current
    setScreen('processing')
    setError(undefined)
    setOutput(undefined)
    setBallTrackResult(undefined)
    setBallMessage(undefined)
    setCurrentTimeMs(0)
    setProgress({ stage: 'preparing', value: 0, message: 'Preparing your private local video…' })

    try {
      const result = await runVideoAnalysis({
        file,
        video,
        signal: controller.signal,
        onProgress: (next) => {
          if (runId === runIdRef.current) setProgress(next)
        },
      })
      if (runId !== runIdRef.current) return
      setOutput(result)
      setBallMessage('Checking for an exact precomputed ball track…')
      void loadPrecomputedBallTrack({
        source: {
          sha256: result.sourceHash.replace(/^sha256:/, ''),
          bytes: file.size,
          durationMs: result.source.durationMs,
          width: result.source.width,
          height: result.source.height,
        },
        signal: controller.signal,
      }).then((ballResult) => {
        if (runId !== runIdRef.current) return
        setBallTrackResult(ballResult)
        setBallMessage(ballResult.message)
      }).catch((ballError) => {
        if (runId !== runIdRef.current) return
        if (ballError instanceof DOMException && ballError.name === 'AbortError') return
        setBallTrackResult(undefined)
        setBallMessage(
          ballError instanceof Error
            ? `Ball visualization unavailable: ${ballError.message}`
            : 'Ball visualization is unavailable.',
        )
      })
      if (result.status === 'ready') {
        setCurrentTimeMs(result.filteredFrames[0]?.timestampMs ?? 0)
      } else {
        setSettingsOpen(true)
      }
      setScreen('analysis')
    } catch (analysisError) {
      if (runId !== runIdRef.current) return
      setError(errorMessage(analysisError))
      setScreen('analysis')
    }
  }

  const handleUpload = (file?: File) => {
    if (!file) return
    releaseRun(true)
    setError(undefined)
    setOutput(undefined)
    setCacheMessage(undefined)
    setBallTrackResult(undefined)
    setBallMessage(undefined)
    setSettingsOpen(false)
    if (!file.size) {
      setError('Choose a non-empty video file.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('For this POC, choose a video smaller than 200 MB.')
      return
    }
    if (typeof URL.createObjectURL !== 'function') {
      setError('This browser cannot open a local video for analysis.')
      return
    }
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setSelectedFile(file)
    setVideoUrl(url)
    setScreen('processing')
  }

  const restart = () => {
    releaseRun(true)
    setScreen('upload')
    setSelectedFile(undefined)
    setVideoUrl(undefined)
    setOutput(undefined)
    setBallTrackResult(undefined)
    setBallMessage(undefined)
    setError(undefined)
    setSettingsOpen(false)
    setCacheMessage(undefined)
    if (inputRef.current) inputRef.current.value = ''
  }

  const retry = () => {
    const video = analysisVideoRef.current
    if (!video || !videoUrl) return
    startedUrlRef.current = videoUrl
    if (video.readyState >= 1) {
      void beginAnalysis(video)
    } else {
      video.addEventListener('loadedmetadata', () => void beginAnalysis(video), { once: true })
      video.load()
    }
  }

  const cancel = () => {
    controllerRef.current?.abort()
    controllerRef.current = undefined
    runIdRef.current += 1
    setOutput(undefined)
    setError('Analysis cancelled. Your video is still available.')
    setScreen('analysis')
  }

  const changePlayer = async (playerId: 'A' | 'B') => {
    if (!output || (output.status === 'ready' && playerId === output.selectedPlayerId)) return
    setCacheMessage('Updating the selected player…')
    try {
      const next = await analyzePoseFrames(output.frames, output.source, playerId)
      if (next.status !== 'ready') throw new Error('The selected player could not be isolated.')
      setOutput({
        ...next,
        sourceHash: output.sourceHash,
        cacheStatus: output.cacheStatus,
      })
      setCurrentTimeMs(next.filteredFrames[0]?.timestampMs ?? 0)
      setCacheMessage(`Player ${playerId} selected.`)
      setSettingsOpen(false)
    } catch (selectionError) {
      setCacheMessage(errorMessage(selectionError))
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

  const readyOutput: CompletedVideoAnalysisOutput | undefined =
    output?.status === 'ready' ? output : undefined
  const displayedFrame = useMemo(() => {
    return poseFrameAtTime(readyOutput?.filteredFrames ?? [], currentTimeMs)
  }, [currentTimeMs, readyOutput?.filteredFrames])
  const selectionPreview = useMemo(() => {
    if (output?.status !== 'selection-required') return undefined
    const trackA = output.tracking.tracks.find((track) => track.id === 'A')
    const trackB = output.tracking.tracks.find((track) => track.id === 'B')
    return {
      frameA: trackA
        ? trackedPoseFrameAtTime(output.frames, trackA.poses, currentTimeMs)
        : undefined,
      frameB: trackB
        ? trackedPoseFrameAtTime(output.frames, trackB.poses, currentTimeMs)
        : undefined,
    }
  }, [currentTimeMs, output])

  const showSettings = Boolean(videoUrl)
  const visibleBallMessage =
    ballTrackResult?.status === 'unavailable'
    || ballMessage?.startsWith('Ball visualization unavailable:')
      ? ballMessage
      : undefined
  const shotSegments = useMemo(
    () => shotSegmentsWithBallEvidence(
      readyOutput?.segments ?? [],
      ballTrackResult?.status === 'available' ? ballTrackResult.track : undefined,
    ),
    [ballTrackResult, readyOutput?.segments],
  )
  const selectShot = (startMs: number) => {
    const video = playbackVideoRef.current
    if (!video) return
    video.currentTime = startMs / 1000
    setCurrentTimeMs(startMs)
  }

  return (
    <main className="app-shell">
      <div className="topbar">
        <header className="brand" aria-label="TennisCoach.AI">
          <span className="brand-mark"><Video size={20} aria-hidden="true" /></span>
          <span>TennisCoach.AI</span>
        </header>
        {showSettings && (
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
            {output && output.tracking.tracks.length > 1 ? (
              <div className="settings-group">
                <span>Tracked player</span>
                <div className="player-buttons">
                  {output.tracking.tracks.map((track) => (
                    <button
                      type="button"
                      key={track.id}
                      className={output.status === 'ready' && track.id === output.selectedPlayerId ? 'is-selected' : ''}
                      onClick={() => void changePlayer(track.id)}
                    >
                      Player {track.id}
                    </button>
                  ))}
                </div>
                <small>
                  {output.status === 'selection-required'
                    ? 'Choose the player to analyze before feedback is published.'
                    : 'The closest stable player is selected automatically when evidence is clear.'}
                </small>
              </div>
            ) : (
              <p>Player selection appears here when more than one person is tracked.</p>
            )}
            <button type="button" className="text-button" onClick={() => void clearCache()}>
              Clear local analysis cache
            </button>
            {cacheMessage && <small role="status">{cacheMessage}</small>}
          </aside>
        )}
      </div>

      {screen === 'upload' ? (
        <section className="upload-view" aria-labelledby="hero-title">
          <h1 id="hero-title">Your personal tennis coach</h1>
          <p className="hero-copy">
            Choose a short tennis clip to review visible posture and movement.
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

          {error && <p className="inline-error" role="alert">{error}</p>}
        </section>
      ) : screen === 'processing' ? (
        <section className="processing-view" aria-labelledby="processing-title" aria-live="polite">
          <p className="eyebrow">LOCAL AI ANALYSIS</p>
          <h1 id="processing-title">Analyzing your tennis video…</h1>
          <p className="result-copy">{progress.message}</p>
          <div className="processing-player" style={{ aspectRatio: sourceAspectRatio }}>
            <video src={videoUrl} controls muted playsInline aria-label="Uploaded tennis video preview" />
          </div>
          <progress value={progress.value} max={1} aria-label="Video analysis progress" />
          <span className="progress-value">{Math.round(progress.value * 100)}%</span>
          <button className="secondary-button" type="button" onClick={cancel}>Cancel analysis</button>
          <video
            ref={analysisVideoRef}
            className="analysis-engine-video"
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            aria-label="Analysis engine video"
            onLoadedMetadata={(event) => {
              if (event.currentTarget.videoWidth && event.currentTarget.videoHeight) {
                setSourceAspectRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight)
              }
              if (startedUrlRef.current === videoUrl) return
              startedUrlRef.current = videoUrl
              void beginAnalysis(event.currentTarget)
            }}
            onError={() => {
              setError('This browser could not decode the selected video. Try MP4, WebM, or MOV.')
              setScreen('analysis')
            }}
          />
        </section>
      ) : (
        <section className="result-view" aria-labelledby="analysis-title">
          <p className="eyebrow">{readyOutput ? 'ANALYSIS READY' : 'VIDEO READY'}</p>
          <h1 id="analysis-title">
            {readyOutput
              ? 'Your tennis analysis'
              : output?.status === 'selection-required'
                ? 'Choose the player to analyze'
                : 'Your video is still available'}
          </h1>

          {readyOutput ? (
            <>
              <PoseViewer
                videoUrl={videoUrl!}
                frame={displayedFrame}
                label="Local pose overlay"
                intrinsicWidth={readyOutput.source.width}
                intrinsicHeight={readyOutput.source.height}
                onVideoRef={(video) => { playbackVideoRef.current = video }}
                onTimeUpdate={setCurrentTimeMs}
                ballTrack={ballTrackResult?.status === 'available' ? ballTrackResult.track : undefined}
                showBadge={false}
                shotSegments={shotSegments}
                currentTimeMs={currentTimeMs}
                shotPlayerLabel={`Player ${readyOutput.selectedPlayerId}`}
              />
              {visibleBallMessage && (
                <p className="ball-availability" role="status">{visibleBallMessage}</p>
              )}
              <ShotList
                segments={shotSegments}
                currentTimeMs={currentTimeMs}
                onSelect={(segment) => selectShot(segment.onsetMs)}
                playerLabel={`Player ${readyOutput.selectedPlayerId}`}
              />
            </>
          ) : output?.status === 'selection-required' ? (
            <>
              <PoseViewer
                videoUrl={videoUrl!}
                frame={selectionPreview?.frameA}
                secondaryFrame={selectionPreview?.frameB}
                label="Player selection preview"
                intrinsicWidth={output.source.width}
                intrinsicHeight={output.source.height}
                primaryPlayerLabel="A"
                secondaryPlayerLabel="B"
                onTimeUpdate={setCurrentTimeMs}
                ballTrack={ballTrackResult?.status === 'available' ? ballTrackResult.track : undefined}
              />
              {visibleBallMessage && (
                <p className="ball-availability" role="status">{visibleBallMessage}</p>
              )}
              <div className="player-selection-card" role="status">
                <Settings size={24} aria-hidden="true" />
                <strong>Player choice required</strong>
                <p>Match the colored pose and letter to the player you want analyzed. No feedback is generated until you choose.</p>
                <div className="player-preview-legend" aria-label="Tracked player color mapping">
                  <span><i className="player-swatch player-swatch--primary" />Player A — cyan overlay</span>
                  <span><i className="player-swatch player-swatch--secondary" />Player B — magenta overlay</span>
                </div>
                <div className="player-selection-buttons">
                  <button type="button" onClick={() => void changePlayer('A')}>
                    Analyze Player A — cyan overlay
                  </button>
                  <button type="button" onClick={() => void changePlayer('B')}>
                    Analyze Player B — magenta overlay
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="analysis-fallback">
              <video src={videoUrl} controls muted playsInline aria-label="Uploaded tennis video" />
              <div role="alert">
                <AlertTriangle size={24} aria-hidden="true" />
                <strong>Pose analysis was not available</strong>
                <p>{error}</p>
                <button type="button" className="secondary-button" onClick={retry}>Retry analysis</button>
              </div>
            </div>
          )}

          <button className="restart-button" type="button" onClick={restart}>
            <RotateCcw size={18} aria-hidden="true" />
            Upload another video
          </button>
          <video
            ref={analysisVideoRef}
            className="analysis-engine-video"
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            aria-label="Analysis engine video"
          />
        </section>
      )}
    </main>
  )
}
