import { useEffect, useRef, useState } from 'react'
import { Film, RotateCcw, ShieldCheck, Upload, Video } from 'lucide-react'

type Screen = 'upload' | 'processing' | 'analysis'

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [screen, setScreen] = useState<Screen>('upload')

  useEffect(() => () => {
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current)
  }, [])

  const handleUpload = (file?: File) => {
    if (!file) return
    setScreen('processing')
    processingTimerRef.current = setTimeout(() => {
      processingTimerRef.current = null
      setScreen('analysis')
    }, 4000)
  }

  const restart = () => {
    if (processingTimerRef.current) {
      clearTimeout(processingTimerRef.current)
      processingTimerRef.current = null
    }
    setScreen('upload')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <main className="app-shell">
      <header className="brand" aria-label="Tennis Coach AI">
        <span className="brand-mark"><Video size={20} aria-hidden="true" /></span>
        <span>Tennis Coach AI</span>
      </header>

      {screen === 'upload' ? (
        <section className="upload-view" aria-labelledby="hero-title">
          <p className="eyebrow">PRIVATE VIDEO REVIEW</p>
          <h1 id="hero-title">Your personal tennis coach</h1>
          <p className="hero-copy">
            Choose your prepared tennis clip to see a clear, visual movement review.
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
            <span>MP4, MOV or WebM</span>
          </label>

          <p className="demo-note">Hack demo mode — upload starts a prepared sample analysis.</p>

          <p className="privacy-note">
            <ShieldCheck size={16} aria-hidden="true" />
            Your selected file is not uploaded or retained.
          </p>
        </section>
      ) : screen === 'processing' ? (
        <section className="processing-view" aria-labelledby="processing-title" aria-live="polite">
          <div className="loader" aria-hidden="true" />
          <p className="eyebrow">HACK DEMO MODE</p>
          <h1 id="processing-title">Analyzing your tennis video…</h1>
          <p className="result-copy">Reviewing posture and ball movement</p>
          <p className="demo-note">Preparing a precomputed sample analysis for this demonstration.</p>
        </section>
      ) : (
        <section className="result-view" aria-labelledby="analysis-title">
          <p className="eyebrow">REVIEW READY</p>
          <h1 id="analysis-title">Prepared analysis demo</h1>
          <div className="analysis-player">
            <div className="code-only-placeholder" role="status" aria-label="Demo video unavailable in code-only release">
              <span className="placeholder-icon"><Film size={34} aria-hidden="true" /></span>
              <strong>Demo video asset not included</strong>
              <p>This code-only source release preserves the interface without distributing media.</p>
            </div>
            <div className="scripted-cue">
              <span className="prepared-sample">Prepared sample</span>
              <div className="cue-heading">
                <span>Preparation</span>
                <strong className="cue-badge cue-badge-good">GOOD</strong>
              </div>
              <p>Balanced starting position.</p>
            </div>
          </div>
          <button className="restart-button" type="button" onClick={restart}>
            <RotateCcw size={18} aria-hidden="true" />
            Upload another video
          </button>
        </section>
      )}
    </main>
  )
}
