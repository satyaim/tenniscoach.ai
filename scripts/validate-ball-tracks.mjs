import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

const args = process.argv.slice(2)
const valueAfter = (flag) => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const artifactDirectory = valueAfter('--artifacts') ?? 'public/ball-tracks'
const sourceMapPath = valueAfter('--source-map')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const privatePattern = /(?:[a-z]:\\|\\users\\|\/users\/|user-local-tennis|satysharma)/i
const forbiddenExtensions = new Set([
  '.avi', '.ckpt', '.gif', '.jpeg', '.jpg', '.mkv', '.mov', '.mp4', '.npy',
  '.npz', '.onnx', '.png', '.pt', '.pth', '.safetensors', '.tflite', '.webm',
])

const manifestPath = join(artifactDirectory, 'manifest.v1.json')
const stableManifestPath = join(artifactDirectory, 'manifest.json')
const [manifestBytes, stableManifestBytes] = await Promise.all([
  readFile(manifestPath),
  readFile(stableManifestPath),
])
assert(manifestBytes.equals(stableManifestBytes), 'Stable and versioned manifests are not byte-identical.')
const manifestText = manifestBytes.toString('utf8')
assert(!privatePattern.test(manifestText), 'Manifest leaks a private path, user identity, or private source filename.')
const manifest = JSON.parse(manifestText)
assert(manifest.schemaVersion === 'precomputed-ball-tracks.v1', 'Unexpected manifest schema version.')
const entries = Object.entries(manifest.entries)
assert(entries.length === 3, `Expected three verified manifest entries, found ${entries.length}.`)

const files = await readdir(artifactDirectory)
for (const name of files) {
  assert(!forbiddenExtensions.has(extname(name).toLowerCase()), `Forbidden media or model artifact ${name}.`)
}

const expectedTrackFiles = new Set()
for (const [sourceDigest, entry] of entries) {
  assert(/^[a-f0-9]{64}$/.test(sourceDigest), `Invalid source digest key ${sourceDigest}.`)
  assert(entry.source.sha256 === sourceDigest, `${entry.label} source digest/key mismatch.`)
  assert(Number.isInteger(entry.source.bytes) && entry.source.bytes > 0, `${entry.label} has invalid source bytes.`)
  assert(['available', 'unavailable'].includes(entry.status), `${entry.label} has invalid status.`)
  assert(!privatePattern.test(JSON.stringify(entry)), `${entry.label} leaks private metadata.`)
  if (entry.status === 'unavailable') {
    assert(!entry.track, `${entry.label} unavailable entry must not name a track.`)
    continue
  }

  const trackPath = join(artifactDirectory, entry.track.path)
  expectedTrackFiles.add(entry.track.path)
  const trackBytes = await readFile(trackPath)
  assert(trackBytes.byteLength === entry.track.bytes, `${entry.label} track byte count mismatch.`)
  assert(sha256(trackBytes) === entry.track.sha256, `${entry.label} track digest mismatch.`)
  const trackText = trackBytes.toString('utf8')
  assert(!privatePattern.test(trackText), `${entry.label} track leaks private metadata.`)
  const track = JSON.parse(trackText)
  assert(track.schemaVersion === 'precomputed-ball-track.v1', `${entry.label} has an unsupported track schema.`)
  assert(track.sourceSha256 === sourceDigest, `${entry.label} track source digest mismatch.`)
  assert(track.coordinateSpace.kind === 'intrinsic-source-pixels', `${entry.label} coordinate space is unsupported.`)
  assert(track.timeline.frameCount === entry.source.frameCount, `${entry.label} frame count mismatch.`)
  assert(track.frames.length === entry.source.frameCount, `${entry.label} timeline is incomplete.`)

  const counts = { observed: 0, ambiguous: 0, abstained: 0 }
  let previousTimestamp = -1
  track.frames.forEach((frame, index) => {
    assert(frame.i === index, `${entry.label} frame indices are not contiguous at ${index}.`)
    assert(finite(frame.t) && frame.t >= previousTimestamp, `${entry.label} timestamps are not monotonic at ${index}.`)
    previousTimestamp = frame.t
    assert(Object.hasOwn(counts, frame.s), `${entry.label} has illegal state ${frame.s}.`)
    counts[frame.s] += 1
    if (frame.s === 'observed') {
      assert(finite(frame.x) && finite(frame.y), `${entry.label} observed frame ${index} has no accepted coordinate.`)
      assert(frame.x >= 0 && frame.x <= entry.source.width, `${entry.label} frame ${index} x is out of bounds.`)
      assert(frame.y >= 0 && frame.y <= entry.source.height, `${entry.label} frame ${index} y is out of bounds.`)
      if (frame.r !== undefined) assert(finite(frame.r) && frame.r > 0, `${entry.label} frame ${index} radius is invalid.`)
    } else {
      assert(frame.x === undefined && frame.y === undefined && frame.r === undefined, `${entry.label} ${frame.s} frame ${index} fabricates geometry.`)
    }
  })
  assert(JSON.stringify(counts) === JSON.stringify(entry.measurements.states), `${entry.label} state counts mismatch.`)
}

const unexpectedTracks = files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name) && !expectedTrackFiles.has(name))
assert(unexpectedTracks.length === 0, `Unreferenced track files: ${unexpectedTracks.join(', ')}.`)

if (sourceMapPath) {
  const sourceMap = await readJson(sourceMapPath)
  assert(Array.isArray(sourceMap) && sourceMap.length === 3, 'Source map must contain exactly three verified entries.')
  for (const source of sourceMap) {
    const bytes = await readFile(source.sourcePath)
    const digest = sha256(bytes)
    const entry = manifest.entries[digest]
    assert(entry, `Source ${source.label} has no exact-hash manifest entry.`)
    assert(entry.source.bytes === bytes.byteLength, `Source ${source.label} byte count changed.`)
  }
}

console.log(`Ball-track validation passed: ${entries.length} sources, ${expectedTrackFiles.size} available tracks, exact digests and legal timelines.`)
