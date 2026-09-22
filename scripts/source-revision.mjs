import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootFiles = new Set([
  'eslint.config.js',
  'index.html',
  'package-lock.json',
  'package.json',
  'tsconfig.app.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
])

const collectFiles = async (root) => {
  const files = []
  const visit = async (path) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else files.push(child)
    }
  }
  for (const directory of ['src', 'scripts', 'public']) await visit(join(root, directory))
  for (const file of rootFiles) files.push(join(root, file))
  return files.sort((left, right) =>
    relative(root, left).replaceAll('\\', '/').localeCompare(relative(root, right).replaceAll('\\', '/')))
}

export const computeSourceRevision = async (root = process.cwd()) => {
  const files = await collectFiles(root)
  const digest = createHash('sha256')
  for (const file of files) {
    const normalizedPath = relative(root, file).replaceAll('\\', '/')
    digest.update(`${normalizedPath}\0`)
    digest.update(await readFile(file))
    digest.update('\0')
  }
  return {
    hash: `sha256:${digest.digest('hex')}`,
    fileCount: files.length,
    inclusions: ['src/**', 'scripts/**', 'public/**', ...[...rootFiles].sort()],
    exclusions: ['docs/evidence/** generated outputs', 'dist/**', 'node_modules/**', '.sdlc/**', 'timestamps and machine state'],
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await computeSourceRevision(), null, 2))
}
