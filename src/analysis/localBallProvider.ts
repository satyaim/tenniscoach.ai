import {
  isBallTrackingResult,
  type BallObservation,
  type BallTrackingProgress,
  type BallTrackingResult,
} from './ballTracking'
import {
  PRECOMPUTED_BALL_TRACK_VERSION,
  type PrecomputedBallFrame,
  type PrecomputedBallTrack,
} from './precomputedBallTrack'

export interface LocalBallProviderConfig {
  endpoint?: string
}

export interface LocalBallProviderUpdate {
  progress: BallTrackingProgress
  track?: PrecomputedBallTrack
}

const configuredEndpoint = () => {
  const value = import.meta.env.VITE_LOCAL_BALL_PROVIDER_URL as string | undefined
  if (!value) return undefined
  const url = new URL(value, window.location.origin)
  if (
    url.origin !== window.location.origin
    && url.hostname !== 'localhost'
    && url.hostname !== '127.0.0.1'
    && url.hostname !== '[::1]'
  ) return undefined
  return url.toString()
}

export const getLocalBallProviderConfig = (): LocalBallProviderConfig => ({
  endpoint: configuredEndpoint(),
})

const observationFrame = (observation: BallObservation): PrecomputedBallFrame => {
  if (
    observation.status === 'visible'
    && observation.provenance === 'learned-observation'
    && observation.center
  ) {
    return {
      i: observation.frameIndex,
      t: observation.timestampMs,
      s: 'observed',
      x: observation.center.x,
      y: observation.center.y,
      r: observation.radius,
      e: {
        heatmapPeak: observation.heatmapPeak,
        candidateCount: observation.candidateCount,
      },
    }
  }
  return {
    i: observation.frameIndex,
    t: observation.timestampMs,
    s: observation.status === 'ambiguous' ? 'ambiguous' : 'abstained',
  }
}

export const observationsToBallTrack = ({
  sourceSha256,
  width,
  height,
  durationMs,
  fps,
  observations,
}: {
  sourceSha256: string
  width: number
  height: number
  durationMs: number
  fps: number
  observations: BallObservation[]
}): PrecomputedBallTrack | undefined => {
  if (!observations.length || !Number.isFinite(fps) || fps <= 0) return undefined
  const byIndex = new Map(observations.map((item) => [item.frameIndex, item]))
  const frameCount = Math.max(...byIndex.keys()) + 1
  const maximumFrameCount = Math.min(20_000, Math.ceil(durationMs * fps / 1000) + 2)
  if (frameCount > maximumFrameCount) {
    throw new Error('Ball observations exceeded the declared source timeline.')
  }
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const observation = byIndex.get(index)
    return observation
      ? observationFrame(observation)
      : { i: index, t: index * 1000 / fps, s: 'abstained' as const }
  })
  return {
    schemaVersion: PRECOMPUTED_BALL_TRACK_VERSION,
    sourceSha256,
    coordinateSpace: {
      kind: 'intrinsic-source-pixels',
      origin: 'top-left',
      xDirection: 'right',
      yDirection: 'down',
      width,
      height,
    },
    timeline: {
      frameIndexOrigin: 0,
      timestampRule: 'frameIndex * 1000 / sourceFps',
      fps,
      frameCount,
      durationMs,
    },
    frames,
  }
}

const parseLine = (line: string) => {
  const value = JSON.parse(line) as {
    type?: string
    progress?: BallTrackingProgress
    result?: unknown
  }
  return value
}

const isProgressObservation = (
  value: BallObservation,
  width: number,
  height: number,
  durationMs: number,
  estimatedTotalFrames?: number,
) =>
  Number.isInteger(value.frameIndex)
  && value.frameIndex >= 0
  && Number.isFinite(value.timestampMs)
  && value.timestampMs >= 0
  && value.timestampMs <= durationMs + 100
  && value.frameIndex < Math.min(20_000, estimatedTotalFrames ?? 20_000)
  && ['visible', 'ambiguous', 'occluded', 'absent', 'abstained'].includes(value.status)
  && ['learned-observation', 'none'].includes(value.provenance)
  && (
    value.center === undefined
    || (
      Number.isFinite(value.center.x)
      && Number.isFinite(value.center.y)
      && value.center.x >= 0
      && value.center.x <= width
      && value.center.y >= 0
      && value.center.y <= height
    )
  )

export const runLocalBallProvider = async ({
  file,
  runId,
  sourceSha256,
  width,
  height,
  durationMs,
  signal,
  onUpdate,
  endpoint = configuredEndpoint(),
}: {
  file: File
  runId: string
  sourceSha256: string
  width: number
  height: number
  durationMs: number
  signal: AbortSignal
  onUpdate: (update: LocalBallProviderUpdate) => void
  endpoint?: string
}): Promise<BallTrackingResult | undefined> => {
  if (!endpoint) return undefined
  const form = new FormData()
  form.set('video', file, file.name)
  form.set('runId', runId)
  form.set('sourceSha256', sourceSha256)
  const response = await fetch(endpoint, {
    method: 'POST',
    body: form,
    signal,
    headers: { Accept: 'application/x-ndjson, application/json' },
  })
  if (!response.ok) throw new Error(`Local ball provider failed (${response.status}).`)
  if (!response.body) throw new Error('Local ball provider returned no response body.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let observations: BallObservation[] = []
  let result: BallTrackingResult | undefined
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const message = parseLine(line)
      if (message.type === 'progress' && message.progress) {
        const progress = message.progress
        if (
          !Number.isInteger(progress.processedFrames)
          || progress.processedFrames < 0
          || progress.processedFrames > 20_000
          || (
            progress.estimatedTotalFrames !== undefined
            && (
              !Number.isInteger(progress.estimatedTotalFrames)
              || progress.estimatedTotalFrames <= 0
              || progress.estimatedTotalFrames > 20_000
            )
          )
          || !Array.isArray(progress.latestObservations)
          || !progress.latestObservations.every((item) =>
            isProgressObservation(
              item,
              width,
              height,
              durationMs,
              progress.estimatedTotalFrames,
            ))
        ) throw new Error('Local ball provider returned invalid progressive evidence.')
        observations = [...observations, ...progress.latestObservations]
        onUpdate({
          progress,
          track: observationsToBallTrack({
            sourceSha256,
            width,
            height,
            durationMs,
            fps: Math.max(1, progress.estimatedTotalFrames
              ? progress.estimatedTotalFrames / (durationMs / 1000)
              : 30),
            observations,
          }),
        })
      } else if (message.type === 'result' && isBallTrackingResult(message.result)) {
        result = message.result
      }
    }
  }
  if (buffer.trim()) {
    const message = parseLine(buffer)
    if (message.type === 'result' && isBallTrackingResult(message.result)) result = message.result
  }
  if (!result) throw new Error('Local ball provider did not return a valid BallTrackingResult.')
  if (
    result.runId !== runId
    || result.source.width !== width
    || result.source.height !== height
    || Math.abs(result.source.durationMs - durationMs) > 20
  ) throw new Error('Local ball provider result did not match the active source run.')
  return result
}
