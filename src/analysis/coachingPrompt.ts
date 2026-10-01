import type { StrokeSegment } from './types'

export const COACHING_PROMPT_VERSION = 'coaching-prompt.v1'
export const COACHING_PROMPT_STORAGE_KEY = 'tenniscoach.coaching-prompt.v1'
export const MAX_COACHING_PROMPT_LENGTH = 4000

export const DEFAULT_COACHING_ANALYSIS_PROMPT = `Act as a conservative recreational tennis coach. Translate the strongest supported visible body-position pattern into one actionable focus.

Tell the player what visible pattern to preserve or adjust, why that pattern generally matters in tennis, one short cue to remember during practice, and one realistic low-risk drill with 2–4 concrete steps, volume, and a visible success check.

Do not merely restate the visual facts. Prefer a focus such as ready position, footwork base, movement efficiency, recovery position, posture and body organization, clearly visible arm or racket spacing, finish position, or consistency across the supplied frames.

Use tennis-specific, moderately directive language such as "Try...", "Aim to...", "Experiment with...", or "A useful next focus is...". Avoid vague advice such as "improve your footwork", "maintain better balance", or "work on consistency". If the visible pattern already looks organized, prescribe a progression drill rather than inventing a fault.`

const hasUnsafeControlCharacters = (value: string) => Array.from(value).some((character) => {
  const code = character.charCodeAt(0)
  return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)
    || (code >= 127 && code <= 159)
})

export const validateCoachingPrompt = (value: unknown) => {
  if (typeof value !== 'string') {
    throw new Error('The coaching analysis prompt must be text.')
  }
  const prompt = value.trim()
  if (!prompt) throw new Error('The coaching analysis prompt cannot be empty.')
  if (prompt.length > MAX_COACHING_PROMPT_LENGTH) {
    throw new Error(
      `The coaching analysis prompt must be ${MAX_COACHING_PROMPT_LENGTH} characters or fewer.`,
    )
  }
  if (hasUnsafeControlCharacters(prompt)) {
    throw new Error('The coaching analysis prompt contains unsupported control characters.')
  }
  return prompt
}

export const coachingPromptError = (value: unknown) => {
  try {
    validateCoachingPrompt(value)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : 'The coaching analysis prompt is invalid.'
  }
}

const stablePromptHash = (value: string) => {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export const coachingPromptIdentity = (value: unknown) => {
  const prompt = validateCoachingPrompt(value)
  return `${COACHING_PROMPT_VERSION}:${stablePromptHash(prompt)}`
}

export const shotInsightCacheKey = (
  sourceHash: string,
  segment: Pick<StrokeSegment, 'id' | 'onsetMs' | 'offsetMs'>,
  prompt: unknown,
) => [
  'shot-insight.v2',
  sourceHash,
  segment.id,
  segment.onsetMs,
  segment.offsetMs,
  coachingPromptIdentity(prompt),
].join(':')

export const loadStoredCoachingPrompt = (
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
) => {
  const stored = storage.getItem(COACHING_PROMPT_STORAGE_KEY)
  if (stored === null) return DEFAULT_COACHING_ANALYSIS_PROMPT
  try {
    return validateCoachingPrompt(stored)
  } catch {
    storage.removeItem(COACHING_PROMPT_STORAGE_KEY)
    return DEFAULT_COACHING_ANALYSIS_PROMPT
  }
}

export const persistCoachingPrompt = (
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  value: unknown,
) => {
  const prompt = validateCoachingPrompt(value)
  if (prompt === DEFAULT_COACHING_ANALYSIS_PROMPT) {
    storage.removeItem(COACHING_PROMPT_STORAGE_KEY)
  } else {
    storage.setItem(COACHING_PROMPT_STORAGE_KEY, prompt)
  }
  return prompt
}
