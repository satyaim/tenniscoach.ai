import { describe, expect, it } from 'vitest'
import { parseShotInsight } from './shotInsight'

describe('shot insight response parsing', () => {
  it('accepts grounded facts and an optional safe cue', () => {
    expect(parseShotInsight({
      visualFacts: [{
        fact: 'The knees are slightly bent.',
        evidenceTimestamps: ['2.98s', '4.12s'],
        confidence: 'medium',
      }],
      coachRecommendation: {
        focusArea: 'Footwork base',
        assessment: 'The stance narrows near the end of the sequence.',
        whyItMatters: 'A repeatable base can make the next movement easier to organize.',
        actionCue: 'Finish with enough space between your feet to move in either direction.',
        drill: {
          name: 'Hit, recover, freeze',
          steps: ['Shadow the movement.', 'Recover to a balanced base.', 'Freeze for one second.'],
          volume: '2 sets of 8 repetitions',
          successCheck: 'Feet finish apart and the head remains between them.',
        },
        evidenceTimestamps: ['2.98s', '4.12s'],
        confidence: 'medium',
      },
      withheld: ['Ball contact is not visible.'],
    }).visualFacts).toHaveLength(1)
  })

  it('fails closed on malformed model output', () => {
    expect(() => parseShotInsight({
      visualFacts: [{ fact: 'Unsupported', evidenceTimestamps: [], confidence: 'low' }],
      coachRecommendation: null,
      withheld: [],
    })).toThrow(/invalid visual fact/i)
  })
})
