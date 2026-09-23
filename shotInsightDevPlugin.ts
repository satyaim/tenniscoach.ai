import { execFile } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import type { Plugin } from 'vite'

const execFileAsync = promisify(execFile)
const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const FORBIDDEN_CLAIM = /\b(contact|impact|early|late|weight shift|weight transfer|racket face|ball path|speed|spin|force|diagnos(?:e|is)|forehand|backhand|serve|volley|smash|winner|error|outcome|tactic)\b/i

interface AccessToken {
  token: string
  expiresAtMs: number
}

let cachedToken: AccessToken | undefined

interface ShotInsightDevPluginOptions {
  apiKey?: string
  endpoint?: string
  deployment?: string
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

const readJsonBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new Error('The selected shot image is too large.')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

const getAzureToken = async () => {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) return cachedToken.token
  const { stdout } = process.platform === 'win32'
    ? await execFileAsync(process.env.ComSpec ?? 'cmd.exe', [
        '/d',
        '/s',
        '/c',
        'az account get-access-token --resource https://cognitiveservices.azure.com --output json',
      ], { maxBuffer: 2 * 1024 * 1024 })
    : await execFileAsync('az', [
        'account',
        'get-access-token',
        '--resource',
        'https://cognitiveservices.azure.com',
        '--output',
        'json',
      ], { maxBuffer: 2 * 1024 * 1024 })
  const token = JSON.parse(stdout) as { accessToken: string, expires_on?: number }
  if (!token.accessToken) throw new Error('Azure CLI authentication is required.')
  cachedToken = {
    token: token.accessToken,
    expiresAtMs: (token.expires_on ?? Math.floor(Date.now() / 1000) + 300) * 1000,
  }
  return token.accessToken
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const validateModelResult = (value: unknown, timestamps: string[]) => {
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

const handleInsight = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: ShotInsightDevPluginOptions,
) => {
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
      json(response, 400, { error: 'The shot insight request is invalid.' })
      return
    }

    const endpoint = options.endpoint ?? 'https://satysharma-aifoundry1.openai.azure.com'
    const deployment = options.deployment ?? 'gpt-4o-mini'
    const authorizationHeaders = options.apiKey
      ? { 'api-key': options.apiKey }
      : { Authorization: `Bearer ${await getAzureToken()}` }
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
    let lastError: unknown
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
              ...authorizationHeaders,
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
        const azurePayload = await azureResponse.json() as unknown
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
        const result = validateModelResult(JSON.parse(content), input.timestamps as string[])
        json(response, 200, result)
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  } catch (error) {
    json(response, 502, {
      error: error instanceof Error ? error.message : 'Azure insight generation failed.',
    })
  }
}

export const shotInsightDevPlugin = (
  options: ShotInsightDevPluginOptions = {},
): Plugin => ({
  name: 'shot-insight-dev-api',
  configureServer(server) {
    server.middlewares.use('/api/shot-insight', (request, response, next) => {
      if (request.method !== 'POST') {
        next()
        return
      }
      void handleInsight(request, response, options)
    })
  },
})
