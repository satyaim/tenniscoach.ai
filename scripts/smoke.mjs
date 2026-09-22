import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
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

console.log('Smoke passed: production shell is present and excluded sample media is absent.')
