import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseShotInsight, requestShotInsight } from './shotInsight'

describe('shot insight response parsing', () => {
  afterEach(() => vi.restoreAllMocks())

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

  it('sends the custom coaching prompt to the same-origin API payload', async () => {
    const payload = {
      visualFacts: [],
      coachRecommendation: null,
      withheld: [],
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await requestShotInsight({
      imageDataUrl: 'data:image/jpeg;base64,AA==',
      timestamps: ['1.00s', '1.20s', '1.40s', '1.60s', '1.80s', '2.00s'],
    }, new AbortController().signal, 'Prefer a concise recovery drill.')

    const request = fetchMock.mock.calls[0][1]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      coachingPrompt: 'Prefer a concise recovery drill.',
    })
  })
})
