import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  server: {
    watch: {
      ignored: ['**/*.mp4', '**/*.jpg', '**/artifacts/**'],
    },
  },
  test: {
    exclude: ['experiments/**', 'node_modules/**', 'dist/**'],
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    pool: 'vmThreads',
    maxWorkers: 1,
    isolate: false,
  },
})
