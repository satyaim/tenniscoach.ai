import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const root = process.cwd()
const modelRelativePath = 'public/models/pose_landmarker_lite-float16-v1.task'
const modelSha256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'
const modelSize = 5_777_746
const execFileAsync = promisify(execFile)

const assertModel = async (path, label) => {
  const bytes = await readFile(path)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (bytes.byteLength !== modelSize || digest !== modelSha256) {
    throw new Error(
      `${label} pose model failed integrity validation: ${bytes.byteLength} bytes, SHA-256 ${digest}.`,
    )
  }
}

try {
  await access(join(root, '.git'))
  await execFileAsync('git', ['ls-files', '--error-unmatch', modelRelativePath], { cwd: root })
} catch (error) {
  const gitMetadataMissing = error?.code === 'ENOENT'
  if (!gitMetadataMissing) {
    throw new Error(`Pose model is not source-controlled at ${modelRelativePath}.`, { cause: error })
  }
}

await assertModel(join(root, modelRelativePath), 'Source')

const html = await readFile(join(root, 'dist', 'index.html'), 'utf8')
if (!html.includes('<div id="root"></div>') || !html.includes('assets/')) {
  throw new Error('Production HTML is missing the application root or bundled assets.')
}

try {
  await access(join(root, 'dist', 'samples'))
  throw new Error('Public build unexpectedly contains excluded sample media.')
} catch (error) {
  if (error instanceof Error && error.message.includes('unexpectedly contains')) throw error
}

await assertModel(
  join(root, 'dist', 'models', 'pose_landmarker_lite-float16-v1.task'),
  'Built',
)
await access(join(root, 'dist', 'models', 'LICENSE-APACHE-2.0.txt'))
await access(join(root, 'dist', 'models', 'ATTRIBUTION.md'))

console.log(
  'Smoke passed: production shell, source-controlled verified pose model, licenses, and media exclusions are present.',
)
