import type { PoseFrame, PoseLandmark } from '../analysis/types'
import type { PlayerTrack } from '../analysis/playerTracker'

const BODY_POINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
const CONNECTIONS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]]

const bounds = (pose: PoseLandmark[]) => {
  const points = BODY_POINTS.map((index) => pose[index]).filter(Boolean)
  const xs = points.map((point) => point.x * 100)
  const ys = points.map((point) => point.y * 100)
  return {
    x: Math.min(...xs) - 2,
    y: Math.min(...ys) - 2,
    width: Math.max(...xs) - Math.min(...xs) + 4,
    height: Math.max(...ys) - Math.min(...ys) + 4,
  }
}

interface PlayerSelectorProps {
  videoUrl: string
  frame: PoseFrame
  frameIndex: number
  tracks: PlayerTrack[]
  selectedId: PlayerTrack['id']
  onSelect: (id: PlayerTrack['id']) => void
}

export function PlayerSelector({ videoUrl, frame, frameIndex, tracks, selectedId, onSelect }: PlayerSelectorProps) {
  return (
    <div className="player-selector-view">
      <video
        src={videoUrl}
        muted
        playsInline
        preload="auto"
        onLoadedData={(event) => { event.currentTarget.currentTime = frame.timestampMs / 1000 }}
        aria-label="Player selection video frame"
      />
      <svg viewBox="0 0 100 100" aria-label="Detected player tracks">
        {tracks.map((track) => {
          const pose = track.poses[frameIndex]
          if (!pose) return null
          const box = bounds(pose)
          return (
            <g
              key={track.id}
              className={selectedId === track.id ? 'player-track player-track--selected' : 'player-track'}
              role="button"
              tabIndex={0}
              aria-label={`Select Player ${track.id}`}
              onClick={() => onSelect(track.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(track.id)
              }}
            >
              <rect {...box} rx="2" />
              {CONNECTIONS.map(([from, to]) => (
                <line
                  key={`${from}-${to}`}
                  x1={pose[from].x * 100}
                  y1={pose[from].y * 100}
                  x2={pose[to].x * 100}
                  y2={pose[to].y * 100}
                />
              ))}
              <text x={box.x + 1} y={Math.max(4, box.y - 1)}>Player {track.id}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
