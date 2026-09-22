/// <reference types="node" />

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach } from 'vitest'
import { analysisCache } from '../analysis/analysisCache'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

beforeEach(async () => {
  await analysisCache.clear()
})

afterEach(async () => {
  cleanup()
  await analysisCache.clear()
})
