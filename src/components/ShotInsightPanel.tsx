import { Sparkles } from 'lucide-react'
import type { ShotInsight } from '../analysis/shotInsight'

interface ShotInsightPanelProps {
  state?: {
    status: 'queued' | 'loading' | 'ready' | 'error'
    insight?: ShotInsight
    message?: string
  }
  onTimestampSelect: (timestamp: string) => void
  onRetry: () => void
}

export function ShotInsightPanel({ state, onTimestampSelect, onRetry }: ShotInsightPanelProps) {
  if (!state) return null
  return (
    <section className="shot-insight" aria-labelledby="shot-insight-title">
      <div className="shot-insight-heading">
        <Sparkles size={20} aria-hidden="true" />
        <div>
          <h2 id="shot-insight-title">TennisCoach.AI insights</h2>
        </div>
      </div>

      {state.status === 'loading' && (
        <p className="shot-insight-status" role="status">Generating grounded visual observations…</p>
      )}
      {state.status === 'queued' && (
        <p className="shot-insight-status" role="status">This insight is queued behind earlier shots…</p>
      )}
      {state.status === 'error' && (
        <div className="shot-insight-error" role="alert">
          <p>Something went wrong while creating grounded coaching cues.</p>
          <button type="button" onClick={onRetry}>Regenerate cues</button>
        </div>
      )}
      {state.status === 'ready' && state.insight && (
        <>
          <div className="shot-insight-facts">
            {state.insight.visualFacts.map((fact) => (
              <article key={`${fact.fact}-${fact.evidenceTimestamps.join('-')}`}>
                <strong>{fact.fact}</strong>
                <div>
                  {fact.evidenceTimestamps.map((timestamp) => (
                    <button
                      type="button"
                      key={timestamp}
                      onClick={() => onTimestampSelect(timestamp)}
                    >
                      {timestamp}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {state.insight.coachRecommendation && (
            <div className="shot-insight-coaching">
              <span>{state.insight.coachRecommendation.focusArea}</span>
              <strong>{state.insight.coachRecommendation.assessment}</strong>
              <p>{state.insight.coachRecommendation.whyItMatters}</p>
              <div className="shot-insight-action">
                <small>Try this cue</small>
                <b>{state.insight.coachRecommendation.actionCue}</b>
              </div>
              <div className="shot-insight-drill">
                <small>Recommended drill</small>
                <b>{state.insight.coachRecommendation.drill.name}</b>
                <ol>
                  {state.insight.coachRecommendation.drill.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p>{state.insight.coachRecommendation.drill.volume}</p>
                <p>Success check: {state.insight.coachRecommendation.drill.successCheck}</p>
              </div>
              <div className="shot-insight-evidence">
                {state.insight.coachRecommendation.evidenceTimestamps.map((timestamp) => (
                  <button
                    type="button"
                    key={timestamp}
                    onClick={() => onTimestampSelect(timestamp)}
                  >
                    {timestamp}
                  </button>
                ))}
              </div>
            </div>
          )}
          {state.insight.withheld.length > 0 && (
            <p className="shot-insight-withheld">
              Withheld: {state.insight.withheld.join(' ')}
            </p>
          )}
        </>
      )}
    </section>
  )
}
