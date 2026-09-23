import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1])
}

const manifestPath = args.get('--manifest')
const knownClips = [
  args.get('--known-1'),
  args.get('--known-2'),
  args.get('--known-3'),
]
const unknownClip = args.get('--unknown')
if (
  !manifestPath
  || !existsSync(manifestPath)
  || knownClips.some((path) => !path || !existsSync(path))
  || !unknownClip
  || !existsSync(unknownClip)
) {
  throw new Error(
    'Pass --manifest and three --known-N clips plus --unknown. Media and generated artifacts remain external.',
  )
}

const browserTargets = [
  ['Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  ['Edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
].filter(([, executable]) => existsSync(executable))
if (browserTargets.length !== 2) throw new Error('Current Chrome and Edge installations are required.')

const manifestBytes = readFileSync(manifestPath)
const manifest = JSON.parse(manifestBytes.toString('utf8'))
if (manifest.schemaVersion !== 'precomputed-ball-tracks.v1') {
  throw new Error('Browser validation requires the frozen precomputed-ball-tracks.v1 manifest.')
}
const artifactDirectory = dirname(manifestPath)
const fileSha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const known = knownClips.map((path) => {
  const sha256 = fileSha256(path)
  const entry = manifest.entries[sha256]
  if (!entry || entry.status !== 'available') {
    throw new Error(`No available manifest entry exists for known clip SHA-256 ${sha256}.`)
  }
  const trackPath = join(artifactDirectory, entry.track.path)
  const trackBytes = readFileSync(trackPath)
  if (createHash('sha256').update(trackBytes).digest('hex') !== entry.track.sha256) {
    throw new Error(`Track digest does not match for ${sha256}.`)
  }
  const track = JSON.parse(trackBytes.toString('utf8'))
  const observed = track.frames.find((frame) => frame.s === 'observed')
  const gap = track.frames.find((frame) => frame.s !== 'observed')
  if (!observed || !gap) throw new Error(`Track ${sha256} needs observed and non-observed frames.`)
  return { path, sha256, entry, track, observed, gap }
})
if (manifest.entries[fileSha256(unknownClip)]) {
  throw new Error('The unknown-video fixture unexpectedly appears in the ball manifest.')
}

const baseUrl = 'http://127.0.0.1:5175/'
const server = spawn(process.execPath, [
  join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'),
  '--host', '127.0.0.1',
  '--port', '5175',
  '--strictPort',
], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk })
server.stderr.on('data', (chunk) => { serverOutput += chunk })

const waitForServer = async () => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {
      // Wait for Vite.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Vite did not start on 5175.\n${serverOutput}`)
}

const waitForPose = async (page) => {
  const heading = page.getByRole('heading', {
    name: /Your tennis analysis|Choose the player to analyze|Your video is still available/,
  })
  await heading.waitFor({ timeout: 180_000 })
  const text = await heading.textContent()
  if (text?.includes('Choose the player')) {
    await page.getByRole('button', { name: 'Analyze Player A — cyan overlay' }).click()
    await page.getByRole('heading', { name: 'Your tennis analysis' }).waitFor({ timeout: 60_000 })
  } else if (text?.includes('still available')) {
    throw new Error(`Pose analysis failed: ${await page.locator('[role="alert"]').textContent()}`)
  }
}

const seek = async (page, timestampMs) => {
  await page.getByLabel('Analyzed tennis video').evaluate(async (video, time) => {
    video.currentTime = Math.max(0, Math.min(video.duration, time / 1000))
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }))
  }, timestampMs)
  await page.waitForTimeout(80)
}

const paintedPixels = (page) => page.getByLabel('Precomputed observed ball overlay').evaluate((canvas) => {
  const context = canvas.getContext('2d')
  if (!context) return 0
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let painted = 0
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) painted += 1
  }
  return painted
})

const installArtifactRoutes = async (context) => {
  await context.route('**/ball-tracks/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/manifest.json') || path.endsWith('/manifest.v1.json')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: manifestBytes })
      return
    }
    const name = basename(path)
    const entry = Object.values(manifest.entries)
      .find((candidate) => candidate.status === 'available' && candidate.track.path === name)
    if (!entry) {
      await route.fulfill({ status: 404, body: 'not found' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: readFileSync(join(artifactDirectory, entry.track.path)),
    })
  })
}

const runBrowser = async (name, executablePath) => {
  const browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await installArtifactRoutes(context)
  await context.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL)
    window.__revokedObjectUrls = []
    URL.revokeObjectURL = (url) => {
      window.__revokedObjectUrls.push(url)
      original(url)
    }
  })
  const page = await context.newPage()
  const evidence = []
  try {
    await page.goto(baseUrl)
    for (const [index, item] of known.entries()) {
      if (index > 0) await page.getByRole('button', { name: 'Upload another video' }).click()
      const started = performance.now()
      await page.getByLabel('Upload tennis video').setInputFiles(item.path)
      await waitForPose(page)
      const poseReadyMs = performance.now() - started
      await page.getByText(
        'Precomputed ball observations are available for this exact video.',
        { exact: true },
      ).waitFor({ timeout: 30_000 })
      const ballReadyMs = performance.now() - started
      await page.getByLabel('Precomputed observed ball overlay').waitFor()

      await seek(page, item.observed.t)
      const observedPixels = await paintedPixels(page)
      if (!observedPixels) throw new Error(`${name}: observed frame rendered no ball marker.`)
      await seek(page, item.gap.t)
      const gapPixels = await paintedPixels(page)
      if (gapPixels) throw new Error(`${name}: non-observed frame rendered ball pixels.`)
      await seek(page, item.observed.t)
      const repeatedPixels = await paintedPixels(page)
      if (!repeatedPixels) throw new Error(`${name}: marker did not recover after seek/reset.`)

      const geometry = await page.getByLabel('Analyzed tennis video').evaluate((video) => {
        const parent = video.parentElement.getBoundingClientRect()
        return {
          intrinsicRatio: video.videoWidth / video.videoHeight,
          displayRatio: parent.width / parent.height,
        }
      })
      if (Math.abs(geometry.intrinsicRatio - geometry.displayRatio) > 0.02) {
        throw new Error(`${name}: contain geometry changed source aspect ratio.`)
      }
      evidence.push({
        sourceSha256: item.sha256,
        orientation: item.entry.source.height > item.entry.source.width ? 'portrait' : 'landscape',
        observedPixels,
        poseReadyMs: Math.round(poseReadyMs),
        ballReadyMs: Math.round(ballReadyMs),
        ballAfterPoseMs: Math.max(0, Math.round(ballReadyMs - poseReadyMs)),
      })
    }

    await page.getByRole('button', { name: 'Upload another video' }).click()
    await page.getByLabel('Upload tennis video').setInputFiles(unknownClip)
    await waitForPose(page)
    await page.getByText(
      'Ball visualization is not available for this exact video.',
      { exact: true },
    ).waitFor({ timeout: 30_000 })
    if (await page.getByLabel('Precomputed observed ball overlay').count()) {
      throw new Error(`${name}: unknown source rendered a ball overlay.`)
    }
    const revokedObjectUrls = await page.evaluate(() => window.__revokedObjectUrls.length)
    if (revokedObjectUrls < known.length) {
      throw new Error(`${name}: replacements did not revoke prior object URLs.`)
    }
    return { name, evidence, unknownPoseOnly: true, revokedObjectUrls }
  } finally {
    await context.close()
    await browser.close()
  }
}

try {
  await waitForServer()
  const results = []
  for (const [name, executablePath] of browserTargets) {
    results.push(await runBrowser(name, executablePath))
  }
  console.log(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    knownSourceSha256: known.map(({ sha256 }) => sha256),
    results,
  }, null, 2))
} finally {
  server.kill()
}

