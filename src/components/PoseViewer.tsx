import type { PoseFrame } from '../analysis/types'

const CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
]

interface PoseViewerProps {
  frame?: PoseFrame
  label: string
  videoUrl?: string
  onVideoRef?: (video: HTMLVideoElement | null) => void
}

export function PoseSkeleton({ frame, label }: { frame?: PoseFrame; label: string }) {
  const pose = frame?.poses[0]
  if (!pose) return null
  return (
    <svg className="pose-overlay" viewBox="0 0 100 100" role="img" aria-label={label}>
      {CONNECTIONS.map(([from, to]) => (
        <line
          key={`${from}-${to}`}
          x1={pose[from].x * 100}
          y1={pose[from].y * 100}
          x2={pose[to].x * 100}
          y2={pose[to].y * 100}
          className="pose-bone"
        />
      ))}
      {pose.map((point, index) =>
        [...new Set(CONNECTIONS.flat())].includes(index) ? (
          <circle
            key={index}
            cx={point.x * 100}
            cy={point.y * 100}
            r={index === 15 || index === 16 ? 1.8 : 1.15}
            className={index === 15 || index === 16 ? 'pose-joint pose-joint--hand' : 'pose-joint'}
          />
        ) : null,
      )}
    </svg>
  )
}

export function PoseViewer({ frame, label, videoUrl, onVideoRef }: PoseViewerProps) {
  return (
    <div className="pose-viewer" aria-label={`Pose visualization: ${label}`}>
      {videoUrl ? (
        <video
          ref={onVideoRef}
          className="source-video"
          src={videoUrl}
          controls
          muted
          playsInline
          aria-label="Analyzed tennis video"
        />
      ) : (
        <div className="demo-scene" aria-hidden="true">
          <span className="court-line court-line--base" />
          <span className="court-line court-line--side" />
          <span className="demo-ball" />
        </div>
      )}
      <PoseSkeleton frame={frame} label={label} />
      <div className="viewer-badge">
        <span className="live-dot" />
        {label}
      </div>
    </div>
  )
}
