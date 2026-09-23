import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { shotInsightDevPlugin } from './shotInsightDevPlugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      shotInsightDevPlugin({
        apiKey: env.AZURE_OPENAI_API_KEY,
        endpoint: env.AZURE_OPENAI_ENDPOINT,
        deployment: env.AZURE_OPENAI_DEPLOYMENT,
      }),
    ],
    publicDir: 'public',
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
  }
})
