import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256Blob } from './analysisCache'
import {
  createBallCacheIdentity,
  clearPrecomputedBallTrackCache,
  loadPrecomputedBallTrack,
  parseBallManifest,
  parseBallTrack,
  type AvailableBallManifestEntry,
} from './precomputedBallTrack'

const sourceHash = 'a'.repeat(64)
const checkpointHash = 'b'.repeat(64)
const receiptHash = 'c'.repeat(64)
const codeRevision = 'd'.repeat(40)

const trackPayload = {
  schemaVersion: 'precomputed-ball-track.v1',
  sourceSha256: sourceHash,
  coordinateSpace: {
    kind: 'intrinsic-source-pixels',
    origin: 'top-left',
    xDirection: 'right',
    yDirection: 'down',
    width: 100,
    height: 50,
  },
  timeline: {
    frameIndexOrigin: 0,
    timestampRule: 'frameIndex * 1000 / sourceFps',
    fps: 10,
    frameCount: 3,
    durationMs: 300,
  },
  frames: [
    { i: 0, t: 0, s: 'observed', x: 10, y: 12, r: 4 },
    { i: 1, t: 100, s: 'ambiguous', e: { candidateCount: 2 } },
    { i: 2, t: 200, s: 'abstained' },
  ],
}

const createFixture = async () => {
  const trackText = `${JSON.stringify(trackPayload)}\n`
  const trackBlob = new Blob([trackText], { type: 'application/json' })
  const trackHash = (await sha256Blob(trackBlob)).replace(/^sha256:/, '')
  const entry = {
    label: 'fixture',
    status: 'available',
    generation: 'reused',
    source: {
      sha256: sourceHash,
      bytes: 4,
      durationMs: 300,
      width: 100,
      height: 50,
      fps: 10,
      frameCount: 3,
    },
    provider: {
      receiptSha256: receiptHash,
      adapterId: 'racketvision-balltrack-quarantined-research-v1',
      model: 'RacketVision BallTrack / MS-TrackNetV3',
      codeRevision,
      runtime: 'test runtime',
      checkpointSha256: checkpointHash,
      checkpointBytes: 46_585_585,
      runtimeArtifactSha256: null,
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
    },
    coordinateSpace: trackPayload.coordinateSpace,
    measurements: {
      processingDurationMs: 100,
      peakMemoryBytes: null,
      frames: 3,
      states: { observed: 1, ambiguous: 1, abstained: 1 },
      observedCoverage: 1 / 3,
    },
    track: {
      path: `${sourceHash}.json`,
      sha256: trackHash,
      bytes: trackBlob.size,
    },
    rightsAndProvenanceWarning: 'Visualization-only research evidence.',
  }
  const manifest = {
    schemaVersion: 'precomputed-ball-tracks.v1',
    artifactPurpose: 'Precomputed test evidence.',
    limitations: ['Test-only fixture.'],
    identity: {
      entryKey: 'full source-file SHA-256',
      trackDigestAlgorithm: 'SHA-256',
      deterministicEncoding: 'UTF-8 JSON with stable insertion order and one trailing newline',
    },
    entries: { [sourceHash]: entry },
  }
  return { trackBlob, entry, manifest }
}

describe('precomputed ball provider', () => {
  beforeEach(() => clearPrecomputedBallTrackCache())

  it('loads only an exact content and metadata match from the stable manifest', async () => {
    const fixture = await createFixture()
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = input.toString()
      if (path === '/ball-tracks/manifest.json') {
        return new Response(JSON.stringify(fixture.manifest), { status: 200 })
      }
      return new Response(await fixture.trackBlob.arrayBuffer(), { status: 200 })
    }) as unknown as typeof fetch

    const result = await loadPrecomputedBallTrack({
      source: {
        sha256: sourceHash,
        bytes: 4,
        durationMs: 300,
        width: 100,
        height: 50,
      },
      signal: new AbortController().signal,
      fetcher,
    })

    expect(result.status).toBe('available')
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/ball-tracks/manifest.json',
      expect.objectContaining({ cache: 'no-cache' }),
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('uses the frozen versioned manifest only when the stable alias is missing', async () => {
    const fixture = await createFixture()
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = input.toString()
      if (path === '/ball-tracks/manifest.json') return new Response('', { status: 404 })
      if (path === '/ball-tracks/manifest.v1.json') {
        return new Response(JSON.stringify(fixture.manifest), { status: 200 })
      }
      return new Response(await fixture.trackBlob.arrayBuffer(), { status: 200 })
    }) as unknown as typeof fetch

    const result = await loadPrecomputedBallTrack({
      source: {
        sha256: sourceHash,
        bytes: 4,
        durationMs: 300,
        width: 100,
        height: 50,
      },
      signal: new AbortController().signal,
      fetcher,
    })

    expect(result.status).toBe('available')
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/ball-tracks/manifest.v1.json',
      expect.objectContaining({ cache: 'no-cache' }),
    )
  })

  it('reuses only the independently revisioned verified ball cache', async () => {
    const fixture = await createFixture()
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (input.toString().includes('manifest')) {
        return new Response(JSON.stringify(fixture.manifest), { status: 200 })
      }
      return new Response(await fixture.trackBlob.arrayBuffer(), { status: 200 })
    }) as unknown as typeof fetch
    const request = {
      source: {
        sha256: sourceHash,
        bytes: 4,
        durationMs: 300,
        width: 100,
        height: 50,
      },
      signal: new AbortController().signal,
      fetcher,
    }

    await loadPrecomputedBallTrack(request)
    await loadPrecomputedBallTrack(request)

    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('stays pose-only for hash or source metadata mismatches', async () => {
    const fixture = await createFixture()
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(fixture.manifest), { status: 200 })) as unknown as typeof fetch

    const unknown = await loadPrecomputedBallTrack({
      source: {
        sha256: 'e'.repeat(64),
        bytes: 4,
        durationMs: 300,
        width: 100,
        height: 50,
      },
      signal: new AbortController().signal,
      fetcher,
    })
    const wrongGeometry = await loadPrecomputedBallTrack({
      source: {
        sha256: sourceHash,
        bytes: 4,
        durationMs: 300,
        width: 101,
        height: 50,
      },
      signal: new AbortController().signal,
      fetcher,
    })

    expect(unknown.status).toBe('unavailable')
    expect(wrongGeometry.status).toBe('unavailable')
  })

  it('rejects digest failure and illegal coordinate-bearing states', async () => {
    const fixture = await createFixture()
    const tampered = new Blob([`${JSON.stringify({ ...trackPayload, extra: true })}\n`])
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      input.toString().includes('manifest')
        ? new Response(JSON.stringify(fixture.manifest), { status: 200 })
        : new Response(await tampered.arrayBuffer(), { status: 200 })) as unknown as typeof fetch

    await expect(loadPrecomputedBallTrack({
      source: {
        sha256: sourceHash,
        bytes: 4,
        durationMs: 300,
        width: 100,
        height: 50,
      },
      signal: new AbortController().signal,
      fetcher,
    })).rejects.toThrow(/byte length|SHA-256/)

    const invalidTrack = structuredClone(trackPayload)
    Object.assign(invalidTrack.frames[1], { x: 10, y: 10 })
    expect(() => parseBallTrack(invalidTrack, fixture.entry as AvailableBallManifestEntry))
      .toThrow(/cannot contain coordinates/)
  })

  it('changes cache identity with track/provider revisions without using pose identity', async () => {
    const fixture = await createFixture()
    const manifest = parseBallManifest(fixture.manifest)
    const entry = manifest.entries[sourceHash] as AvailableBallManifestEntry
    const first = await createBallCacheIdentity(manifest, entry)
    const revisedManifest = parseBallManifest({
      ...fixture.manifest,
      entries: {
        [sourceHash]: {
          ...fixture.entry,
          track: { ...fixture.entry.track, sha256: 'f'.repeat(64) },
        },
      },
    })
    const second = await createBallCacheIdentity(
      revisedManifest,
      revisedManifest.entries[sourceHash] as AvailableBallManifestEntry,
    )

    expect(first).not.toBe(second)
    expect(first).not.toContain('pose')
  })

  it('honors cancellation before publishing a fetched track', async () => {
    const fixture = await createFixture()
    const controller = new AbortController()
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (input.toString().includes('manifest')) {
        return new Response(JSON.stringify(fixture.manifest), { status: 200 })
      }
      controller.abort()
      return new Response(await fixture.trackBlob.arrayBuffer(), { status: 200 })
    }) as unknown as typeof fetch

    await expect(loadPrecomputedBallTrack({
      source: {
        sha256: sourceHash,
        bytes: 4,
        durationMs: 300,
        width: 100,
        height: 50,
      },
      signal: controller.signal,
      fetcher,
    })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
