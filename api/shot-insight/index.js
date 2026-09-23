/* global Buffer, fetch, module, process */

const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const FORBIDDEN_CLAIM = /\b(contact|impact|early|late|weight shift|weight transfer|racket face|ball path|speed|spin|force|diagnos(?:e|is)|forehand|backhand|serve|volley|smash|winner|error|outcome|tactic)\b/i

const isRecord = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readJsonBody = async (request) => {
  const body = typeof request.rawBody === 'string'
    ? request.rawBody
    : JSON.stringify(request.body ?? null)
  if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
    throw new Error('The selected shot image is too large.')
  }
  return JSON.parse(body)
}

const validateModelResult = (value, timestamps) => {
  if (
    !isRecord(value)
    || !Array.isArray(value.visualFacts)
    || value.visualFacts.length > 2
    || !Array.isArray(value.withheld)
    || !value.withheld.every((item) => typeof item === 'string')
  ) throw new Error('Azure returned an invalid insight payload.')

  for (const fact of value.visualFacts) {
    if (
      !isRecord(fact)
      || typeof fact.fact !== 'string'
      || FORBIDDEN_CLAIM.test(fact.fact)
      || !Array.isArray(fact.evidenceTimestamps)
      || !fact.evidenceTimestamps.length
      || !fact.evidenceTimestamps.every((timestamp) =>
        typeof timestamp === 'string' && timestamps.includes(timestamp))
      || (fact.confidence !== 'high' && fact.confidence !== 'medium')
    ) throw new Error('Azure produced an unsupported or ungrounded visual claim.')
  }

  if (value.coachRecommendation !== null) {
    if (
      !isRecord(value.coachRecommendation)
      || typeof value.coachRecommendation.focusArea !== 'string'
      || typeof value.coachRecommendation.assessment !== 'string'
      || typeof value.coachRecommendation.whyItMatters !== 'string'
      || typeof value.coachRecommendation.actionCue !== 'string'
      || !isRecord(value.coachRecommendation.drill)
      || typeof value.coachRecommendation.drill.name !== 'string'
      || !Array.isArray(value.coachRecommendation.drill.steps)
      || !value.coachRecommendation.drill.steps.length
      || !value.coachRecommendation.drill.steps.every((step) => typeof step === 'string')
      || typeof value.coachRecommendation.drill.volume !== 'string'
      || typeof value.coachRecommendation.drill.successCheck !== 'string'
      || !Array.isArray(value.coachRecommendation.evidenceTimestamps)
      || !value.coachRecommendation.evidenceTimestamps.length
      || !value.coachRecommendation.evidenceTimestamps.every((timestamp) =>
        typeof timestamp === 'string' && timestamps.includes(timestamp))
      || (value.coachRecommendation.confidence !== 'high'
        && value.coachRecommendation.confidence !== 'medium')
      || [
        value.coachRecommendation.assessment,
        value.coachRecommendation.whyItMatters,
        value.coachRecommendation.actionCue,
        value.coachRecommendation.drill.name,
        ...value.coachRecommendation.drill.steps,
        value.coachRecommendation.drill.successCheck,
      ].some((text) => FORBIDDEN_CLAIM.test(text))
    ) throw new Error('Azure produced an unsupported coaching recommendation.')
  }
  return value
}

const handleInsight = async (request) => {
  try {
    const input = await readJsonBody(request)
    if (
      !isRecord(input)
      || typeof input.imageDataUrl !== 'string'
      || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.imageDataUrl)
      || !Array.isArray(input.timestamps)
      || input.timestamps.length !== 6
      || !input.timestamps.every((timestamp) =>
        typeof timestamp === 'string' && /^\d+\.\d{2}s$/.test(timestamp))
    ) {
      return { status: 400, jsonBody: { error: 'The shot insight request is invalid.' } }
    }

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT
      ?? 'https://satysharma-aifoundry1.openai.azure.com'
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini'
    const apiKey = process.env.AZURE_OPENAI_API_KEY
    if (!apiKey) throw new Error('Azure OpenAI authentication is unavailable.')
    const prompt = `The image is a chronological 3x2 contact sheet of one tennis-video segment.
Each panel has one of these exact timestamps: ${input.timestamps.join(', ')}.
Inspect only the prominent near-court player.

Return JSON with exactly:
{
  "visualFacts": [{"fact": string, "evidenceTimestamps": string[], "confidence": "high"|"medium"}],
  "coachRecommendation": {
    "focusArea": string,
    "assessment": string,
    "whyItMatters": string,
    "actionCue": string,
    "drill": {
      "name": string,
      "steps": string[],
      "volume": string,
      "successCheck": string
    },
    "evidenceTimestamps": string[],
    "confidence": "high"|"medium"
  } | null,
  "withheld": string[]
}

Only report directly visible image-plane facts such as foot spacing, knee bend,
torso angle, arm position, head position, or changes in those positions.
Then act as a conservative recreational tennis coach: choose at most one
actionable focus supported by those facts, explain the general coaching reason,
give one short cue, and prescribe a low-risk drill with 2–4 concrete steps,
volume, and a visible success check. Phrase the recommendation as an experiment,
not proof that the player is incorrect.

Do not merely restate the visual facts. Translate the strongest supported
pattern into a practical adjustment or progression. Use tennis-specific
coaching language and choose one focus from:
- ready position
- footwork base
- movement efficiency
- recovery position
- posture and body organization
- arm or racket spacing when clearly visible
- finish position
- consistency across the supplied frames

The recommendation must tell the player:
1. What visible pattern to preserve or adjust.
2. Why that pattern generally matters in tennis.
3. One short cue to remember during practice.
4. One realistic drill with setup, execution, repetitions, and a visible
   success check.

Be moderately directive. Prefer "Try...", "Aim to...", "Experiment with...",
or "A useful next focus is...". Avoid vague advice such as "improve your
footwork", "maintain better balance", or "work on consistency". If the visible
pattern already looks organized, prescribe a progression drill rather than
inventing a fault.

Forbidden: asserting contact or timing, weight shift/transfer, racket face,
ball path, speed/spin/force, medical diagnosis, stroke classification,
winner/error/outcome, or tactics. Do not claim the recommendation caused or
will guarantee a performance result. General tennis principles may be stated
with cautious language such as "can help" or "generally makes it easier".
Use exact timestamps. Maximum two visual facts and one recommendation.`
    let lastError
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retryInstruction = attempt === 0
        ? ''
        : '\nYour previous response was rejected. Remove unsupported inference, use only listed timestamps, and keep the drill tied to directly visible body positions.'
      try {
        const azureResponse = await fetch(
          `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=2024-10-21`,
          {
            method: 'POST',
            headers: {
              'api-key': apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messages: [
                {
                  role: 'system',
                  content: 'Act as a visual measurement assistant and conservative recreational tennis coach. Withhold biomechanical inference that cannot be established from pixels.',
                },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: `${prompt}${retryInstruction}` },
                    { type: 'image_url', image_url: { url: input.imageDataUrl, detail: 'low' } },
                  ],
                },
              ],
              temperature: 0,
              max_tokens: 1000,
              response_format: { type: 'json_object' },
            }),
          },
        )
        const azurePayload = await azureResponse.json()
        if (!azureResponse.ok || !isRecord(azurePayload)) {
          throw new Error('Azure vision insight generation failed.')
        }
        const choices = azurePayload.choices
        const content = Array.isArray(choices)
          && isRecord(choices[0])
          && isRecord(choices[0].message)
          && typeof choices[0].message.content === 'string'
          ? choices[0].message.content
          : undefined
        if (!content) throw new Error('Azure returned no insight content.')
        const result = validateModelResult(JSON.parse(content), input.timestamps)
        return { status: 200, jsonBody: result }
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  } catch (error) {
    return {
      status: 502,
      jsonBody: {
        error: error instanceof Error ? error.message : 'Azure insight generation failed.',
      },
    }
  }
}

module.exports = async (context, request) => {
  const result = await handleInsight(request)
  context.res = {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
    body: result.jsonBody,
  }
}
