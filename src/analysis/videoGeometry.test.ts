import { describe, expect, it } from 'vitest'
import { containVideoRect } from './videoGeometry'

describe('video contain geometry', () => {
  it('letterboxes landscape video without distorting source aspect', () => {
    const rect = containVideoRect(1920, 1080, 800, 800)
    expect(rect).toMatchObject({ x: 0, width: 800 })
    expect(rect.height).toBeCloseTo(450)
    expect(rect.y).toBeCloseTo(175)
  })

  it('pillarboxes portrait video without distorting source aspect', () => {
    const rect = containVideoRect(1080, 1920, 800, 450)
    expect(rect).toMatchObject({ y: 0, height: 450 })
    expect(rect.width).toBeCloseTo(253.125)
    expect(rect.x).toBeCloseTo(273.4375)
  })
})
