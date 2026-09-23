import { spawn } from 'node:child_process'
import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1])
}

const landscape = args.get('--landscape') ?? process.env.TC_LANDSCAPE_CLIP
const portrait = args.get('--portrait') ?? process.env.TC_PORTRAIT_CLIP
if (!landscape || !portrait || !existsSync(landscape) || !existsSync(portrait)) {
  throw new Error('Pass rights-cleared clips with --landscape <path> --portrait <path>.')
}

const browserTargets = [
  ['Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  ['Edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
].filter(([, executable]) => existsSync(executable))
if (browserTargets.length !== 2) throw new Error('Current Chrome and Edge installations are required.')

const baseUrl = 'http://127.0.0.1:5174/'
const server = spawn(process.execPath, [
  join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'),
  '--host', '127.0.0.1',
  '--port', '5174',
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
  throw new Error(`Vite did not start on 5174.\n${serverOutput}`)
}

const waitForAnalysis = async (page) => {
  const heading = page.getByRole('heading', { name: /Your tennis analysis|Choose the player to analyze|Your video is still available/ })
  await heading.waitFor({ timeout: 180_000 })
  const text = await heading.textContent()
  if (text?.includes('Choose the player')) {
    await page.getByText('Player A — cyan overlay', { exact: true }).waitFor()
    await page.getByText('Player B — magenta overlay', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Analyze Player B — magenta overlay' }).click()
    await page.getByRole('heading', { name: 'Your tennis analysis' }).waitFor({ timeout: 60_000 })
    await page.getByText(/Player B tracked/).waitFor()
    return 'selected-player-B'
  }
  if (text?.includes('still available')) {
    throw new Error(`Analysis failed: ${await page.locator('[role="alert"]').textContent()}`)
  }
  return 'auto-player'
}

const upload = async (page, path) => {
  await page.getByLabel('Upload tennis video').setInputFiles(path)
}

const selectionFixtureModule = `
const makePose = (centerX) => Array.from({ length: 33 }, (_, index) => ({
  x: centerX + ((index % 4) - 1.5) * 0.025,
  y: 0.18 + Math.floor(index / 4) * 0.06,
  visibility: 0.99,
}))
const poseA = makePose(0.28)
const poseB = makePose(0.68)
const frames = [
  { timestampMs: 0, poses: [poseA] },
  { timestampMs: 100, poses: [poseA, poseB] },
]
const tracks = [
  { id: 'A', poses: [poseA, poseA], persistence: 1, coverage: 1, averageArea: 0.2, averageCenterY: 0.6, primaryScore: 0.8, warnings: [] },
  { id: 'B', poses: [undefined, poseB], persistence: 0.5, coverage: 1, averageArea: 0.2, averageCenterY: 0.6, primaryScore: 0.79, warnings: [] },
]
const source = { durationMs: 4000, width: 1280, height: 720 }
const tracking = {
  tracks,
  selectionConfidence: 0.2,
  selectionMethod: 'manual-required',
  warnings: ['Player choice required for browser fixture.'],
}
const resultFor = (selectedPlayerId) => ({
  analyzer: 'browser-selection-fixture',
  source: 'upload',
  stroke: 'unknown',
  strokeSource: 'unknown',
  strokePresentation: { label: 'unknown motion', provenance: 'unknown' },
  handedness: 'unknown',
  timing: null,
  inputQuality: 'usable',
  poseTrackQuality: 'usable',
  segmentationReliability: 'medium',
  observations: [],
  mainObservation: 'No coaching observation is published by this selection fixture.',
  coachingNote: 'Selection mapping fixture only.',
  moments: [
    { id: 'onset', label: 'Movement onset', timestampMs: 0, note: 'fixture' },
    { id: 'preparation', label: 'Preparation', timestampMs: 0, note: 'fixture' },
    { id: 'peak', label: 'Movement peak', timestampMs: 0, note: 'fixture' },
    { id: 'offset', label: 'Movement offset', timestampMs: 0, note: 'fixture' },
  ],
  peakFrame: 0,
  segment: {
    id: 'fixture', revision: 1, status: 'final', source: 'automatic',
    startFrame: 0, onsetFrame: 0, peakFrame: 0, offsetFrame: 0, endFrame: 0,
    startMs: 0, onsetMs: 0, peakMs: 0, offsetMs: 0, endMs: 0,
    reliability: 'medium', poseEvidence: 'high', boundaryReliability: 'medium',
    boundaryUncertaintyMs: 0, warnings: [], sampledFrameCount: 1, effectiveFps: 6,
    diagnostics: {
      effectiveFps: 6, medianIntervalMs: 166, intervalIqrMs: 0, maxGapMs: 166,
      poseCoverage: 1, scaleStability: 1, eventProminence: 1,
    },
  },
  trace: [],
  limitations: ['Selection fixture only.'],
  safety: 'No coaching output.',
  captureContext: {
    viewpoint: 'browser fixture', cameraMotion: 'unknown', cuts: 'none',
    resolution: '1280x720', sourceFps: 6, samplingConfig: 'fixture',
    normalizationGeometry: 'shoulder-width-2d-v1',
  },
  playerSelection: {
    selectedPlayerId, selectionMethod: 'manual', recommendationBand: 'insufficient',
    trackingWarnings: tracking.warnings,
  },
})
export const runVideoAnalysis = async () => ({
  status: 'selection-required', source, sourceHash: 'fixture', frames, tracking,
  selectionMethod: 'manual-required', cacheStatus: 'miss',
})
export const analyzePoseFrames = async (_frames, _source, selectedPlayerId) => ({
  status: 'ready', source, frames, filteredFrames: [{
    timestampMs: 0,
    poses: [selectedPlayerId === 'B' ? poseB : poseA],
  }],
  tracking, selectedPlayerId, segments: [], result: resultFor(selectedPlayerId),
})
`

const verifySelectionMapping = async (browser) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.route('**/src/analysis/videoAnalysisPipeline.ts*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: selectionFixtureModule }))
  const page = await context.newPage()
  try {
    await page.goto(baseUrl)
    await upload(page, landscape)
    await page.getByRole('heading', { name: 'Choose the player to analyze' }).waitFor()
    await page.getByLabel('Player A pose overlay').waitFor()
    await page.getByLabel('Player B pose overlay').waitFor()
    await page.getByText('Player A — cyan overlay', { exact: true }).waitFor()
    await page.getByText('Player B — magenta overlay', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Analyze Player B — magenta overlay' }).click()
    await page.getByText(/Player B tracked/).waitFor()
    return 'selected-player-B'
  } finally {
    await context.close()
  }
}

const runBrowser = async (name, executablePath) => {
  const browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addInitScript(() => {
    window.__videoFrameCallbacks = 0
    const requestVideoFrameCallback = HTMLVideoElement.prototype.requestVideoFrameCallback
    if (requestVideoFrameCallback) {
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        return requestVideoFrameCallback.call(this, (now, metadata) => {
          window.__videoFrameCallbacks += 1
          callback(now, metadata)
        })
      }
    }
    const original = URL.revokeObjectURL.bind(URL)
    window.__revokedObjectUrls = []
    URL.revokeObjectURL = (url) => {
      window.__revokedObjectUrls.push(url)
      original(url)
    }
  })
  const page = await context.newPage()
  const timings = {}
  try {
    await page.goto(baseUrl)
    const firstStart = performance.now()
    await upload(page, landscape)
    const firstSelection = await waitForAnalysis(page)
    timings.firstAnalysisMs = Math.round(performance.now() - firstStart)
    await page.getByLabel('Analyzed tennis video').evaluate(async (video) => {
      video.currentTime = Math.min(1, video.duration / 3)
      await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }))
      video.currentTime = Math.min(2, video.duration / 2)
      await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }))
    })
    const overlay = page.locator('canvas.pose-overlay')
    await overlay.waitFor()
    const canvasSize = await overlay.evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.getBoundingClientRect().width,
      cssHeight: canvas.getBoundingClientRect().height,
      dpr: devicePixelRatio,
    }))
    if (canvasSize.width < canvasSize.cssWidth * canvasSize.dpr * 0.95) {
      throw new Error(`${name}: overlay canvas is not DPR-aware.`)
    }
    const frameCallbacksBeforePlayback = await page.evaluate(() => window.__videoFrameCallbacks)
    await page.getByLabel('Analyzed tennis video').evaluate(async (video) => {
      await video.play()
      await new Promise((resolve) => setTimeout(resolve, 750))
      video.pause()
    })
    const frameCallbacksAfterPlayback = await page.evaluate(() => window.__videoFrameCallbacks)
    if (frameCallbacksAfterPlayback <= frameCallbacksBeforePlayback + 1) {
      throw new Error(`${name}: overlay time did not advance with presented video frames.`)
    }

    await page.getByRole('button', { name: 'Upload another video' }).click()
    const secondStart = performance.now()
    await upload(page, landscape)
    await waitForAnalysis(page)
    timings.cacheAnalysisMs = Math.round(performance.now() - secondStart)
    await page.getByText('reused local analysis').waitFor()

    await page.getByRole('button', { name: 'Upload another video' }).click()
    await upload(page, portrait)
    await waitForAnalysis(page)
    const portraitGeometry = await page.getByLabel('Analyzed tennis video').evaluate((video) => {
      const parent = video.parentElement.getBoundingClientRect()
      return {
        intrinsicRatio: video.videoWidth / video.videoHeight,
        displayRatio: parent.width / parent.height,
      }
    })
    if (Math.abs(portraitGeometry.intrinsicRatio - portraitGeometry.displayRatio) > 0.02) {
      throw new Error(`${name}: portrait contain geometry changed source aspect ratio.`)
    }

    await page.getByRole('button', { name: 'Analysis settings' }).click()
    await page.getByRole('button', { name: 'Clear local analysis cache' }).click()
    await page.getByRole('button', { name: 'Analysis settings' }).click()
    await page.getByRole('button', { name: 'Upload another video' }).click()
    await upload(page, landscape)
    await page.getByText(/Analyzing body position/).waitFor({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Cancel analysis' }).click()
    await page.getByRole('heading', { name: 'Your video is still available' }).waitFor()

    const revoked = await page.evaluate(() => window.__revokedObjectUrls.length)
    if (revoked < 3) throw new Error(`${name}: object URLs were not revoked across replacements.`)

    const invalidPath = join(tmpdir(), `tenniscoach-invalid-${process.pid}.mp4`)
    writeFileSync(invalidPath, 'not a video')
    await page.getByRole('button', { name: 'Upload another video' }).click()
    await upload(page, invalidPath)
    await page.getByRole('heading', { name: 'Your video is still available' }).waitFor()
    await page.getByLabel('Uploaded tennis video').waitFor()
    unlinkSync(invalidPath)

    const cpuContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const cpuPage = await cpuContext.newPage()
    await cpuPage.goto(`${baseUrl}?poseDelegate=cpu`)
    const cpuStart = performance.now()
    await upload(cpuPage, landscape)
    await waitForAnalysis(cpuPage)
    timings.forcedCpuAnalysisMs = Math.round(performance.now() - cpuStart)
    await cpuContext.close()

    const cancelContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await cancelContext.route('**/models/pose_landmarker_lite-float16-v1.task', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })
    const cancelPage = await cancelContext.newPage()
    await cancelPage.goto(baseUrl)
    await upload(cancelPage, landscape)
    await cancelPage.getByText(/Loading the pose model/).waitFor({ timeout: 60_000 })
    await cancelPage.getByRole('button', { name: 'Cancel analysis' }).click()
    await cancelPage.getByRole('heading', { name: 'Your video is still available' }).waitFor()
    await cancelContext.close()

    const selectionMapping = await verifySelectionMapping(browser)
    return { name, firstSelection, selectionMapping, canvasSize, portraitGeometry, timings }
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
  console.log(JSON.stringify({ clips: { landscape, portrait }, results }, null, 2))
} finally {
  server.kill()
}
