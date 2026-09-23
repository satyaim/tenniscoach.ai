import type { StrokeSegment } from '../analysis/types'

const timeLabel = (timestampMs: number) => {
  const seconds = Math.max(0, timestampMs) / 1000
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

const activeSegmentId = (segments: StrokeSegment[], timestampMs: number) =>
  segments.find((segment) =>
    timestampMs >= segment.onsetMs && timestampMs <= segment.offsetMs)?.id

interface ShotProgressRailProps {
  segments: StrokeSegment[]
  durationMs: number
  currentTimeMs: number
  onSelect: (segment: StrokeSegment) => void
  playerLabel?: string
}

export function ShotProgressRail({
  segments,
  durationMs,
  currentTimeMs,
  onSelect,
  playerLabel,
}: ShotProgressRailProps) {
  if (!segments.length) return null
  const duration = Math.max(1, durationMs)
  const activeId = activeSegmentId(segments, currentTimeMs)

  return (
    <div
      className="shot-progress-rail"
      aria-label={`${playerLabel ? `${playerLabel} ` : ''}shot segments on video timeline`}
    >
      {segments.map((segment, index) => (
        <button
          type="button"
          key={segment.id}
          className={[
            'shot-progress-segment',
            segment.status === 'provisional' ? 'shot-progress-segment--review' : '',
            segment.id === activeId ? 'shot-progress-segment--active' : '',
          ].filter(Boolean).join(' ')}
          style={{
            left: `${Math.max(0, segment.onsetMs / duration * 100)}%`,
            width: `${Math.max(0.6, (segment.offsetMs - segment.onsetMs) / duration * 100)}%`,
          }}
          onClick={() => onSelect(segment)}
          aria-label={`Shot ${index + 1}, ${timeLabel(segment.onsetMs)} to ${timeLabel(segment.offsetMs)}`}
        />
      ))}
      <i
        className="shot-progress-playhead"
        style={{ left: `${Math.min(100, Math.max(0, currentTimeMs / duration * 100))}%` }}
      />
    </div>
  )
}

interface ShotListProps {
  segments: StrokeSegment[]
  currentTimeMs: number
  onSelect: (segment: StrokeSegment) => void
  playerLabel?: string
}

export function ShotList({ segments, currentTimeMs, onSelect, playerLabel }: ShotListProps) {
  if (!segments.length) return null
  const activeId = activeSegmentId(segments, currentTimeMs)

  return (
    <section className="shot-list" aria-labelledby="shot-list-title">
      <h2 id="shot-list-title">{playerLabel ? `${playerLabel} shots` : 'Shots'}</h2>
      <div>
        {segments.map((segment, index) => (
          <button
            type="button"
            key={segment.id}
            className={segment.id === activeId ? 'is-active' : ''}
            onClick={() => onSelect(segment)}
          >
            <strong>Shot {index + 1}</strong>
            <span>{timeLabel(segment.onsetMs)}–{timeLabel(segment.offsetMs)}</span>
            {segment.status === 'provisional' && <small>Review segment</small>}
          </button>
        ))}
      </div>
    </section>
  )
}
