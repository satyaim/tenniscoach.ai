import { describe, expect, it } from 'vitest'
import {
  ballProviderCatalog,
  canExecuteProvider,
  executableProviderBindings,
  getBallProvider,
} from './providerRegistry'

describe('provider registry', () => {
  it('keeps production ball inference dark without executable bindings', () => {
    expect(executableProviderBindings.size).toBe(0)
    expect(ballProviderCatalog.every((provider) => !canExecuteProvider(provider))).toBe(true)
    expect(ballProviderCatalog.some((provider) => provider.availability === 'rights-blocked')).toBe(true)
  })

  it('fails closed for an unknown provider ID', () => {
    expect(getBallProvider('missing').id).toBe('no-approved-ball-model')
  })
})
