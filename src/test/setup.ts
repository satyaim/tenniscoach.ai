/// <reference types="node" />

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, vi } from 'vitest'
import { analysisCache } from '../analysis/analysisCache'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

beforeEach(async () => {
  await analysisCache.clear()
})

afterEach(async () => {
  cleanup()
  await analysisCache.clear()
})
