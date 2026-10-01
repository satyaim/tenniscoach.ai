import { describe, expect, it, vi } from 'vitest'
import {
  coachingPromptIdentity,
  COACHING_PROMPT_STORAGE_KEY,
  DEFAULT_COACHING_ANALYSIS_PROMPT,
  loadStoredCoachingPrompt,
  MAX_COACHING_PROMPT_LENGTH,
  persistCoachingPrompt,
  shotInsightCacheKey,
  validateCoachingPrompt,
} from './coachingPrompt'

const segment = { id: 'shot-1', onsetMs: 100, offsetMs: 900 }

describe('coaching prompt preferences', () => {
  it('validates, trims, persists, and resets only local prompt text', () => {
    const storage = {
      getItem: vi.fn().mockReturnValue('  Focus on a simple recovery cue.  '),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }

    expect(loadStoredCoachingPrompt(storage)).toBe('Focus on a simple recovery cue.')
    expect(persistCoachingPrompt(storage, '  Prefer shadow drills.  '))
      .toBe('Prefer shadow drills.')
    expect(storage.setItem).toHaveBeenCalledWith(
      COACHING_PROMPT_STORAGE_KEY,
      'Prefer shadow drills.',
    )

    persistCoachingPrompt(storage, DEFAULT_COACHING_ANALYSIS_PROMPT)
    expect(storage.removeItem).toHaveBeenCalledWith(COACHING_PROMPT_STORAGE_KEY)
  })

  it('rejects empty, oversized, binary/control, and non-string values', () => {
    expect(() => validateCoachingPrompt('   ')).toThrow(/cannot be empty/i)
    expect(() => validateCoachingPrompt('a'.repeat(MAX_COACHING_PROMPT_LENGTH + 1)))
      .toThrow(/4000 characters/i)
    expect(() => validateCoachingPrompt('focus\u0000cue')).toThrow(/control characters/i)
    expect(() => validateCoachingPrompt({ prompt: 'unsafe' })).toThrow(/must be text/i)
  })

  it('versions and hashes prompt text into shot-insight cache identity', () => {
    const first = shotInsightCacheKey('source', segment, 'Prefer recovery cues.')
    const same = shotInsightCacheKey('source', segment, '  Prefer recovery cues.  ')
    const changed = shotInsightCacheKey('source', segment, 'Prefer posture cues.')

    expect(first).toBe(same)
    expect(changed).not.toBe(first)
    expect(first).toContain(coachingPromptIdentity('Prefer recovery cues.'))
    expect(first).toContain('coaching-prompt.v1')
  })
})
