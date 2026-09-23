import type { StrokeSegment } from './types'

const CONTACT_SHEET_COLUMNS = 3
const CONTACT_SHEET_FRAME_COUNT = 6
const CONTACT_SHEET_CELL_WIDTH = 240
const CONTACT_SHEET_LABEL_HEIGHT = 30

export interface ShotInsightFact {
  fact: string
  evidenceTimestamps: string[]
  confidence: 'high' | 'medium'
}

export interface ShotInsight {
  visualFacts: ShotInsightFact[]
  coachRecommendation: {
    focusArea: string
    assessment: string
    whyItMatters: string
    actionCue: string
    drill: {
      name: string
      steps: string[]
      volume: string
      successCheck: string
    }
    evidenceTimestamps: string[]
    confidence: 'high' | 'medium'
  } | null
  withheld: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isConfidence = (value: unknown): value is ShotInsightFact['confidence'] =>
  value === 'high' || value === 'medium'

export const parseShotInsight = (value: unknown): ShotInsight => {
  if (
    !isRecord(value)
    || !Array.isArray(value.visualFacts)
    || !Array.isArray(value.withheld)
    || !value.withheld.every((item) => typeof item === 'string')
  ) throw new Error('Azure returned an invalid shot-insight response.')

  const visualFacts = value.visualFacts.map((item) => {
    if (
      !isRecord(item)
      || typeof item.fact !== 'string'
      || !Array.isArray(item.evidenceTimestamps)
      || !item.evidenceTimestamps.length
      || !item.evidenceTimestamps.every((timestamp) => typeof timestamp === 'string')
      || !isConfidence(item.confidence)
    ) throw new Error('Azure returned an invalid visual fact.')
    return {
      fact: item.fact,
      evidenceTimestamps: item.evidenceTimestamps as string[],
      confidence: item.confidence,
    }
  })

  let coachRecommendation: ShotInsight['coachRecommendation'] = null
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
      || !value.coachRecommendation.evidenceTimestamps.every(
        (timestamp) => typeof timestamp === 'string',
      )
      || !isConfidence(value.coachRecommendation.confidence)
    ) throw new Error('Azure returned an invalid coaching recommendation.')
    coachRecommendation = {
      focusArea: value.coachRecommendation.focusArea,
      assessment: value.coachRecommendation.assessment,
      whyItMatters: value.coachRecommendation.whyItMatters,
      actionCue: value.coachRecommendation.actionCue,
      drill: {
        name: value.coachRecommendation.drill.name,
        steps: value.coachRecommendation.drill.steps as string[],
        volume: value.coachRecommendation.drill.volume,
        successCheck: value.coachRecommendation.drill.successCheck,
      },
      evidenceTimestamps: value.coachRecommendation.evidenceTimestamps as string[],
      confidence: value.coachRecommendation.confidence,
    }
  }

  return {
    visualFacts,
    coachRecommendation,
    withheld: value.withheld as string[],
  }
}

const abortError = () => new DOMException('Insight generation cancelled.', 'AbortError')

const waitForVideoEvent = (
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'seeked',
  signal: AbortSignal,
) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) {
    reject(abortError())
    return
  }
  const cleanup = () => {
    video.removeEventListener(eventName, complete)
    video.removeEventListener('error', fail)
    signal.removeEventListener('abort', cancel)
  }
  const complete = () => {
    cleanup()
    resolve()
  }
  const fail = () => {
    cleanup()
    reject(new Error('The selected shot frames could not be decoded.'))
  }
  const cancel = () => {
    cleanup()
    reject(abortError())
  }
  video.addEventListener(eventName, complete, { once: true })
  video.addEventListener('error', fail, { once: true })
  signal.addEventListener('abort', cancel, { once: true })
})

const timestampLabel = (timestampMs: number) => `${(timestampMs / 1000).toFixed(2)}s`

export const buildShotContactSheet = async (
  videoUrl: string,
  segment: StrokeSegment,
  signal: AbortSignal,
) => {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = videoUrl

  try {
    video.load()
    if (video.readyState < 1) await waitForVideoEvent(video, 'loadedmetadata', signal)
    const startMs = Math.max(0, segment.onsetMs)
    const endMs = Math.min(video.duration * 1000, Math.max(startMs, segment.offsetMs))
    const timestampsMs = Array.from({ length: CONTACT_SHEET_FRAME_COUNT }, (_, index) =>
      startMs + (endMs - startMs) * index / (CONTACT_SHEET_FRAME_COUNT - 1))
    const sourceWidth = Math.max(1, video.videoWidth)
    const sourceHeight = Math.max(1, video.videoHeight)
    const cellHeight = Math.round(sourceHeight * CONTACT_SHEET_CELL_WIDTH / sourceWidth)
    const rows = Math.ceil(CONTACT_SHEET_FRAME_COUNT / CONTACT_SHEET_COLUMNS)
    const canvas = document.createElement('canvas')
    canvas.width = CONTACT_SHEET_CELL_WIDTH * CONTACT_SHEET_COLUMNS
    canvas.height = (cellHeight + CONTACT_SHEET_LABEL_HEIGHT) * rows
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot create the shot contact sheet.')
    context.fillStyle = '#07120e'
    context.fillRect(0, 0, canvas.width, canvas.height)

    for (let index = 0; index < timestampsMs.length; index += 1) {
      if (signal.aborted) throw abortError()
      video.currentTime = timestampsMs[index] / 1000
      await waitForVideoEvent(video, 'seeked', signal)
      const x = (index % CONTACT_SHEET_COLUMNS) * CONTACT_SHEET_CELL_WIDTH
      const y = Math.floor(index / CONTACT_SHEET_COLUMNS) * (cellHeight + CONTACT_SHEET_LABEL_HEIGHT)
      context.drawImage(video, x, y, CONTACT_SHEET_CELL_WIDTH, cellHeight)
      context.fillStyle = '#07120e'
      context.fillRect(x, y + cellHeight, CONTACT_SHEET_CELL_WIDTH, CONTACT_SHEET_LABEL_HEIGHT)
      context.fillStyle = '#ffffff'
      context.font = '700 18px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(
        timestampLabel(timestampsMs[index]),
        x + CONTACT_SHEET_CELL_WIDTH / 2,
        y + cellHeight + CONTACT_SHEET_LABEL_HEIGHT / 2,
      )
    }

    return {
      imageDataUrl: canvas.toDataURL('image/jpeg', 0.86),
      timestamps: timestampsMs.map(timestampLabel),
    }
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
}

export const generateShotInsight = async (
  videoUrl: string,
  segment: StrokeSegment,
  signal: AbortSignal,
) => {
  const contactSheet = await buildShotContactSheet(videoUrl, segment, signal)
  const response = await fetch('/api/shot-insight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageDataUrl: contactSheet.imageDataUrl,
      timestamps: contactSheet.timestamps,
    }),
    signal,
  })
  const payload = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : 'Azure insight generation is unavailable.',
    )
  }
  return parseShotInsight(payload)
}
