import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const SCHEMA_VERSION = 'precomputed-ball-tracks.v1'
const TRACK_SCHEMA_VERSION = 'precomputed-ball-track.v1'
const EXPECTED_ADAPTER = 'racketvision-balltrack-quarantined-research-v1'
const EXPECTED_MODEL_VERSION = 'c44af2a08524d3cb54d818f19686f4cdea4d2793'
const EXPECTED_CHECKPOINT = '00d707b9db7a49561c411e4765956e79bcd7c7e20c7a0a535073440b3e972342'
const EXPECTED_ONNX = '50d77f3d1e568d92615abc22c46121a21840be759f7bd37ddd6da07f1f857941'
const RIGHTS_WARNING =
  'Quarantined demo evidence only. Source-media, checkpoint, annotation, and training-media rights are unresolved; no redistribution, accuracy, contact, timing, tactics, uploaded-video inference, or production-model approval is implied.'

const args = process.argv.slice(2)
const valueAfter = (flag) => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const mapPath = valueAfter('--map')
const outputDirectory = valueAfter('--output') ?? 'public/ball-tracks'
const checkOnly = args.includes('--check')

if (!mapPath) {
  throw new Error('Usage: node scripts/build-ball-tracks.mjs --map <local-map.json> [--output <directory>] [--check]')
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const round = (value) => Number(value.toFixed(6))
const finite = (value) => typeof value === 'number' && Number.isFinite(value)

const stableJson = (value, compact = false) =>
  `${JSON.stringify(value, null, compact ? undefined : 2)}\n`

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const observationEvidence = (observation) => {
  const evidence = {}
  if (finite(observation.heatmapPeak)) evidence.heatmapPeak = round(observation.heatmapPeak)
  if (finite(observation.detectorConfidence)) {
    evidence.componentMean = round(observation.detectorConfidence)
  }
  if (Number.isInteger(observation.candidateCount)) {
    evidence.candidateCount = observation.candidateCount
  }
  return evidence
}

const compactFrame = (frame, observation, width, height) => {
  const state = frame.state === 'visible' ? 'observed' : frame.state
  assert(['observed', 'ambiguous', 'abstained'].includes(state), `Unsupported frame state ${frame.state}.`)
  assert(observation, `Frame ${frame.frameIndex} has no observation record.`)
  assert(observation.frameIndex === frame.frameIndex, `Observation mismatch at frame ${frame.frameIndex}.`)
  assert(Math.abs(observation.timestampMs - frame.timestampMs) < 0.001, `Timestamp mismatch at frame ${frame.frameIndex}.`)

  const output = {
    i: frame.frameIndex,
    t: round(frame.timestampMs),
    s: state,
  }
  const evidence = observationEvidence(observation)
  if (Object.keys(evidence).length) output.e = evidence

  if (state === 'observed') {
    assert(observation.provenance === 'learned-observation', `Observed frame ${frame.frameIndex} has invalid provenance.`)
    assert(finite(observation.center?.x) && finite(observation.center?.y), `Observed frame ${frame.frameIndex} has no center.`)
    assert(observation.center.x >= 0 && observation.center.x <= width, `Observed frame ${frame.frameIndex} x is out of bounds.`)
    assert(observation.center.y >= 0 && observation.center.y <= height, `Observed frame ${frame.frameIndex} y is out of bounds.`)
    output.x = round(observation.center.x)
    output.y = round(observation.center.y)
    if (finite(observation.radius)) {
      assert(observation.radius > 0, `Observed frame ${frame.frameIndex} has an invalid radius.`)
      output.r = round(observation.radius)
    }
  } else {
    assert(observation.center === undefined, `${state} frame ${frame.frameIndex} must not assert a center.`)
  }

  return output
}

const resultIdentity = (resultBytes, result) => {
  const checkpoint = result.model?.artifacts?.find((artifact) => artifact.name === 'balltrack_best.pth')
  assert(result.model?.adapterId === EXPECTED_ADAPTER, 'Unexpected BallTrack adapter identity.')
  assert(result.model?.modelVersion === EXPECTED_MODEL_VERSION, 'Unexpected BallTrack code revision.')
  assert(checkpoint?.sha256 === EXPECTED_CHECKPOINT, 'Unexpected BallTrack checkpoint identity.')

  const runtimeArtifact = result.experiment?.runtimeArtifact
  if (runtimeArtifact) {
    assert(runtimeArtifact.sha256 === EXPECTED_ONNX, 'Unexpected ONNX runtime artifact identity.')
  }

  const conditions = result.model.benchmarkConditions
  assert(conditions.includes('threshold=0.5'), 'The learned threshold is not the pinned value.')
  assert(conditions.includes('ambiguity_ratio=0.35'), 'The ambiguity ratio is not the pinned value.')

  return {
    receiptSha256: sha256(resultBytes),
    adapterId: result.model.adapterId,
    model: result.model.modelName,
    codeRevision: result.model.modelVersion,
    runtime: result.model.runtime,
    checkpointSha256: checkpoint.sha256,
    checkpointBytes: checkpoint.sizeBytes,
    runtimeArtifactSha256: runtimeArtifact?.sha256 ?? null,
    config: {
      modelInput: '512x288',
      historyFrames: 4,
      medianBackground: true,
      threshold: 0.5,
      ambiguityRatio: 0.35,
      interpolation: false,
      smoothing: false,
      trajectoryRepair: false,
    },
  }
}

const buildAvailable = async (mapping, sourceBytes, sourceDigest, resultBytes, result) => {
  assert(result.schemaVersion === 'ball-track.v2', `${mapping.label} has an unsupported result schema.`)
  assert(result.status === 'complete', `${mapping.label} result is not complete.`)
  assert(result.source?.sha256 === sourceDigest, `${mapping.label} source digest does not match its learned result.`)
  assert(result.source.frameCount === result.frames.length, `${mapping.label} frame accounting is incomplete.`)
  assert(result.observations.length === result.frames.length, `${mapping.label} observation accounting is incomplete.`)
  assert(result.metrics?.processedFrames === result.source.frameCount, `${mapping.label} processed-frame count is incomplete.`)
  assert(result.metrics?.accountedFrames === result.source.frameCount, `${mapping.label} accounted-frame count is incomplete.`)
  assert(result.metrics?.droppedFrames === 0, `${mapping.label} dropped source frames.`)
  assert(result.metrics?.repairedFrames === 0, `${mapping.label} contains repaired frames.`)
  assert(result.inpaintedPoints?.length === 0, `${mapping.label} contains forbidden inpainted points.`)

  const observations = new Map(result.observations.map((observation) => [observation.frameIndex, observation]))
  const frames = result.frames.map((frame, index) => {
    assert(frame.frameIndex === index, `${mapping.label} frame timeline is not contiguous.`)
    const expectedTimestamp = index * 1000 / result.source.fps
    assert(Math.abs(frame.timestampMs - expectedTimestamp) < 0.001, `${mapping.label} timestamp rule changed at frame ${index}.`)
    return compactFrame(frame, observations.get(index), result.source.width, result.source.height)
  })
  const counts = Object.fromEntries(
    ['observed', 'ambiguous', 'abstained'].map((state) => [
      state,
      frames.filter((frame) => frame.s === state).length,
    ]),
  )
  assert(Object.values(counts).reduce((sum, count) => sum + count, 0) === frames.length, `${mapping.label} state accounting failed.`)

  const track = {
    schemaVersion: TRACK_SCHEMA_VERSION,
    sourceSha256: sourceDigest,
    coordinateSpace: {
      kind: 'intrinsic-source-pixels',
      origin: 'top-left',
      xDirection: 'right',
      yDirection: 'down',
      width: result.source.width,
      height: result.source.height,
    },
    timeline: {
      frameIndexOrigin: 0,
      timestampRule: 'frameIndex * 1000 / sourceFps',
      fps: result.source.fps,
      frameCount: result.source.frameCount,
      durationMs: result.source.durationMs,
    },
    frames,
  }
  const trackBytes = Buffer.from(stableJson(track, true))
  const trackFile = `${sourceDigest}.json`
  const peakMemoryBytes =
    result.experiment?.resources?.peakCpuRssBytes ??
    result.metrics?.observation?.cpuPeakMemoryBytes ??
    null

  return {
    trackFile,
    trackBytes,
    manifestEntry: {
      label: mapping.label,
      status: 'available',
      generation: mapping.generation,
      source: {
        sha256: sourceDigest,
        bytes: sourceBytes.byteLength,
        durationMs: result.source.durationMs,
        width: result.source.width,
        height: result.source.height,
        fps: result.source.fps,
        frameCount: result.source.frameCount,
      },
      provider: resultIdentity(resultBytes, result),
      coordinateSpace: track.coordinateSpace,
      measurements: {
        processingDurationMs: result.metrics.processingDurationMs,
        peakMemoryBytes,
        frames: result.source.frameCount,
        states: counts,
        observedCoverage: counts.observed / result.source.frameCount,
      },
      track: {
        path: trackFile,
        sha256: sha256(trackBytes),
        bytes: trackBytes.byteLength,
      },
      rightsAndProvenanceWarning: RIGHTS_WARNING,
    },
  }
}

const buildUnavailable = (mapping, sourceBytes, sourceDigest, resultBytes, result) => ({
  manifestEntry: {
    label: mapping.label,
    status: 'unavailable',
    generation: mapping.generation,
    source: {
      sha256: sourceDigest,
      bytes: sourceBytes.byteLength,
      durationMs: result.source?.durationMs ?? null,
      width: result.source?.width ?? null,
      height: result.source?.height ?? null,
      fps: result.source?.fps ?? null,
      frameCount: result.source?.frameCount ?? null,
    },
    provider: {
      receiptSha256: sha256(resultBytes),
      adapterId: result.model?.adapterId ?? EXPECTED_ADAPTER,
      model: result.model?.modelName ?? 'RacketVision BallTrack / MS-TrackNetV3',
      codeRevision: result.model?.modelVersion ?? EXPECTED_MODEL_VERSION,
      checkpointSha256: EXPECTED_CHECKPOINT,
    },
    unavailableReason: result.abstentionReason ?? result.failures?.join('; ') ?? 'Exact learned runtime was unavailable.',
    rightsAndProvenanceWarning: RIGHTS_WARNING,
  },
})

const mappings = await readJson(mapPath)
assert(Array.isArray(mappings) && mappings.length === 3, 'The local build map must contain exactly three verified sources.')
assert(new Set(mappings.map(({ label }) => label)).size === 3, 'Build-map labels must be unique.')

const entries = {}
const trackFiles = new Map()
for (const mapping of mappings) {
  assert(/^[a-z0-9-]+$/.test(mapping.label), `Invalid neutral label ${mapping.label}.`)
  assert(['reused', 'newly-inferred', 'unavailable'].includes(mapping.generation), `Invalid generation mode for ${mapping.label}.`)
  const sourceBytes = await readFile(mapping.sourcePath)
  const sourceDigest = sha256(sourceBytes)
  const resultBytes = await readFile(mapping.resultPath)
  const result = JSON.parse(resultBytes)
  const built = result.status === 'complete'
    ? await buildAvailable(mapping, sourceBytes, sourceDigest, resultBytes, result)
    : buildUnavailable(mapping, sourceBytes, sourceDigest, resultBytes, result)
  assert(!entries[sourceDigest], `Duplicate source digest ${sourceDigest}.`)
  entries[sourceDigest] = built.manifestEntry
  if (built.trackFile) trackFiles.set(built.trackFile, built.trackBytes)
}

const manifest = {
  schemaVersion: SCHEMA_VERSION,
  artifactPurpose: 'Precomputed, quarantined learned ball-localization tracks for fixed demo sources.',
  limitations: [
    'These artifacts are not general uploaded-video ball inference.',
    'They do not establish accuracy, contact, bounce, timing, tactics, speed, spin, or production model approval.',
    'Only direct learned observations are accepted; ambiguous and abstained frames have no coordinates.',
  ],
  identity: {
    entryKey: 'full source-file SHA-256',
    trackDigestAlgorithm: 'SHA-256',
    deterministicEncoding: 'UTF-8 JSON with stable insertion order and one trailing newline',
  },
  entries: Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left.localeCompare(right))),
}
const manifestBytes = Buffer.from(stableJson(manifest))

if (checkOnly) {
  const expected = new Map([
    ['manifest.json', manifestBytes],
    ['manifest.v1.json', manifestBytes],
    ...trackFiles,
  ])
  const actualNames = (await readdir(outputDirectory)).filter((name) => name.endsWith('.json')).sort()
  assert(
    JSON.stringify(actualNames) === JSON.stringify([...expected.keys()].sort()),
    `Artifact inventory differs: expected ${[...expected.keys()].sort()}, found ${actualNames}.`,
  )
  for (const [name, bytes] of expected) {
    const actual = await readFile(join(outputDirectory, name))
    assert(actual.equals(bytes), `${name} is not deterministic relative to the pinned source/result map.`)
  }
  console.log(`Deterministic build check passed for ${expected.size} JSON artifacts.`)
} else {
  await mkdir(outputDirectory, { recursive: true })
  for (const [name, bytes] of trackFiles) await writeFile(join(outputDirectory, name), bytes)
  await writeFile(join(outputDirectory, 'manifest.v1.json'), manifestBytes)
  await writeFile(join(outputDirectory, 'manifest.json'), manifestBytes)
  const totalBytes = (manifestBytes.byteLength * 2) + [...trackFiles.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0)
  console.log(`Built ${trackFiles.size} tracks and two byte-identical manifests (${totalBytes} bytes) in ${relative(process.cwd(), outputDirectory)}.`)
}
