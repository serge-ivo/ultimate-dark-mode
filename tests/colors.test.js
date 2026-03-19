import { describe, it, expect } from 'vitest'
import {
  parseColor,
  getColorLightness,
  isLightColor,
  isDarkColor,
  remapColor,
  remapTextColor,
  isMediaTag
} from '../src/content/colors.js'

describe('parseColor', () => {
  it('parses rgb() strings', () => {
    expect(parseColor('rgb(255, 255, 255)')).toEqual({ r: 1, g: 1, b: 1 })
    expect(parseColor('rgb(0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseColor('rgb(128, 128, 128)')).toEqual({
      r: 128 / 255,
      g: 128 / 255,
      b: 128 / 255
    })
  })

  it('parses rgba() strings', () => {
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 1, g: 0, b: 0 })
    expect(parseColor('rgba(0, 128, 255, 1)')).toEqual({
      r: 0,
      g: 128 / 255,
      b: 1
    })
  })

  it('returns null for invalid inputs', () => {
    expect(parseColor(null)).toBeNull()
    expect(parseColor(undefined)).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(parseColor('transparent')).toBeNull()
    expect(parseColor('not-a-color')).toBeNull()
    expect(parseColor(42)).toBeNull()
  })

  it('returns null for hex colors (not supported)', () => {
    expect(parseColor('#ffffff')).toBeNull()
    expect(parseColor('#000')).toBeNull()
  })
})

describe('getColorLightness', () => {
  it('returns 1 for white', () => {
    const l = getColorLightness('rgb(255, 255, 255)')
    expect(l).toBeCloseTo(1.0, 2)
  })

  it('returns 0 for black', () => {
    const l = getColorLightness('rgb(0, 0, 0)')
    expect(l).toBeCloseTo(0.0, 2)
  })

  it('returns ~0.5 for mid-gray', () => {
    // rgb(128, 128, 128) → luminance ≈ 0.502
    const l = getColorLightness('rgb(128, 128, 128)')
    expect(l).toBeGreaterThan(0.4)
    expect(l).toBeLessThan(0.6)
  })

  it('weights green channel highest (perceptual luminance)', () => {
    const red = getColorLightness('rgb(255, 0, 0)')
    const green = getColorLightness('rgb(0, 255, 0)')
    const blue = getColorLightness('rgb(0, 0, 255)')
    expect(green).toBeGreaterThan(red)
    expect(green).toBeGreaterThan(blue)
    expect(red).toBeGreaterThan(blue)
  })

  it('returns 0.5 for unparseable strings', () => {
    expect(getColorLightness('transparent')).toBe(0.5)
    expect(getColorLightness('')).toBe(0.5)
    expect(getColorLightness('#fff')).toBe(0.5)
  })

  it('handles rgba strings', () => {
    const l = getColorLightness('rgba(255, 255, 255, 0.5)')
    expect(l).toBeCloseTo(1.0, 2)
  })
})

describe('isLightColor', () => {
  it('identifies white as light', () => {
    expect(isLightColor('rgb(255, 255, 255)')).toBe(true)
  })

  it('identifies near-white as light', () => {
    expect(isLightColor('rgb(240, 240, 240)')).toBe(true)
  })

  it('identifies black as not light', () => {
    expect(isLightColor('rgb(0, 0, 0)')).toBe(false)
  })

  it('identifies mid-gray as not light (below default threshold 0.6)', () => {
    expect(isLightColor('rgb(128, 128, 128)')).toBe(false)
  })

  it('respects custom threshold', () => {
    expect(isLightColor('rgb(128, 128, 128)', 0.3)).toBe(true)
    expect(isLightColor('rgb(128, 128, 128)', 0.9)).toBe(false)
  })
})

describe('isDarkColor', () => {
  it('identifies black as dark', () => {
    expect(isDarkColor('rgb(0, 0, 0)')).toBe(true)
  })

  it('identifies dark gray as dark', () => {
    expect(isDarkColor('rgb(50, 50, 50)')).toBe(true)
  })

  it('identifies white as not dark', () => {
    expect(isDarkColor('rgb(255, 255, 255)')).toBe(false)
  })

  it('respects custom threshold', () => {
    expect(isDarkColor('rgb(128, 128, 128)', 0.6)).toBe(true)
    expect(isDarkColor('rgb(128, 128, 128)', 0.1)).toBe(false)
  })
})

describe('remapColor', () => {
  it('maps white background to dark surface', () => {
    const result = remapColor('rgb(255, 255, 255)')
    // lightness ≈ 1.0 → darkL = 0.15 + (1 - 1.0) * 0.25 = 0.15
    expect(result).toMatch(/^oklch\(0\.1[0-9] 0\.01 260\)$/)
  })

  it('maps light gray to slightly lighter dark surface', () => {
    const result = remapColor('rgb(200, 200, 200)')
    // lightness ≈ 0.78 → darkL = 0.15 + (1 - 0.78) * 0.25 ≈ 0.205
    expect(result).toMatch(/^oklch\(0\.\d+ 0\.01 260\)$/)
    // Should be darker than mid but lighter than pure white mapping
    const darkL = parseFloat(result.match(/oklch\(([\d.]+)/)[1])
    expect(darkL).toBeGreaterThan(0.15)
    expect(darkL).toBeLessThan(0.30)
  })

  it('never produces a light output (always stays in dark range)', () => {
    const colors = [
      'rgb(255, 255, 255)',
      'rgb(200, 200, 200)',
      'rgb(150, 150, 150)',
      'rgb(100, 100, 100)',
      'rgb(50, 50, 50)',
      'rgb(0, 0, 0)'
    ]
    for (const color of colors) {
      const result = remapColor(color)
      const darkL = parseFloat(result.match(/oklch\(([\d.]+)/)[1])
      expect(darkL).toBeLessThanOrEqual(0.40)
    }
  })

  it('outputs valid oklch format', () => {
    const result = remapColor('rgb(255, 255, 255)')
    expect(result).toMatch(/^oklch\(\d+\.\d+ \d+\.\d+ \d+\)$/)
  })

  it('preserves neutral hue (260) and low chroma (0.01)', () => {
    const result = remapColor('rgb(255, 128, 0)')
    expect(result).toContain('0.01 260')
  })
})

describe('remapTextColor', () => {
  it('maps black text to light text', () => {
    const result = remapTextColor('rgb(0, 0, 0)')
    // lightness = 0 → lightL = 0.75 + 0 * 0.38 = 0.75
    expect(result).toMatch(/^oklch\(0\.75 0\.01 260\)$/)
  })

  it('maps dark gray text to lighter text', () => {
    const result = remapTextColor('rgb(50, 50, 50)')
    const lightL = parseFloat(result.match(/oklch\(([\d.]+)/)[1])
    expect(lightL).toBeGreaterThan(0.75)
    expect(lightL).toBeLessThanOrEqual(0.90)
  })

  it('caps output at 0.90 to avoid pure white', () => {
    // Even for mid-tones, output should not exceed 0.90
    const result = remapTextColor('rgb(128, 128, 128)')
    const lightL = parseFloat(result.match(/oklch\(([\d.]+)/)[1])
    expect(lightL).toBeLessThanOrEqual(0.90)
  })

  it('always produces readable text (lightness >= 0.75)', () => {
    const colors = [
      'rgb(0, 0, 0)',
      'rgb(30, 30, 30)',
      'rgb(60, 60, 60)',
      'rgb(80, 80, 80)'
    ]
    for (const color of colors) {
      const result = remapTextColor(color)
      const lightL = parseFloat(result.match(/oklch\(([\d.]+)/)[1])
      expect(lightL).toBeGreaterThanOrEqual(0.75)
    }
  })

  it('outputs valid oklch format', () => {
    const result = remapTextColor('rgb(0, 0, 0)')
    expect(result).toMatch(/^oklch\(\d+\.\d+ \d+\.\d+ \d+\)$/)
  })
})

describe('isMediaTag', () => {
  it('identifies media elements', () => {
    expect(isMediaTag('IMG')).toBe(true)
    expect(isMediaTag('img')).toBe(true)
    expect(isMediaTag('VIDEO')).toBe(true)
    expect(isMediaTag('video')).toBe(true)
    expect(isMediaTag('CANVAS')).toBe(true)
    expect(isMediaTag('PICTURE')).toBe(true)
    expect(isMediaTag('IFRAME')).toBe(true)
    expect(isMediaTag('EMBED')).toBe(true)
    expect(isMediaTag('OBJECT')).toBe(true)
    expect(isMediaTag('SVG')).toBe(true)
    expect(isMediaTag('svg')).toBe(true)
  })

  it('rejects non-media elements', () => {
    expect(isMediaTag('DIV')).toBe(false)
    expect(isMediaTag('SPAN')).toBe(false)
    expect(isMediaTag('P')).toBe(false)
    expect(isMediaTag('A')).toBe(false)
    expect(isMediaTag('BUTTON')).toBe(false)
    expect(isMediaTag('INPUT')).toBe(false)
  })

  it('handles null/undefined', () => {
    expect(isMediaTag(null)).toBe(false)
    expect(isMediaTag(undefined)).toBe(false)
    expect(isMediaTag('')).toBe(false)
  })
})

describe('color remapping consistency', () => {
  it('light backgrounds and dark text produce sufficient contrast', () => {
    // White bg → dark surface, black text → light text
    const bgResult = remapColor('rgb(255, 255, 255)')
    const textResult = remapTextColor('rgb(0, 0, 0)')

    const bgL = parseFloat(bgResult.match(/oklch\(([\d.]+)/)[1])
    const textL = parseFloat(textResult.match(/oklch\(([\d.]+)/)[1])

    // Text should be significantly lighter than background
    expect(textL - bgL).toBeGreaterThan(0.5)
  })

  it('remapped colors stay within their respective ranges', () => {
    // Background remapping: should stay in 0.15-0.40 range
    // Text remapping: should stay in 0.75-0.90 range
    // This ensures they never overlap (which would break readability)
    const bgColors = ['rgb(255,255,255)', 'rgb(200,200,200)', 'rgb(150,150,150)']
    const textColors = ['rgb(0,0,0)', 'rgb(30,30,30)', 'rgb(60,60,60)']

    for (const bg of bgColors) {
      const bgL = parseFloat(remapColor(bg).match(/oklch\(([\d.]+)/)[1])
      expect(bgL).toBeLessThan(0.40)
    }

    for (const text of textColors) {
      const textL = parseFloat(remapTextColor(text).match(/oklch\(([\d.]+)/)[1])
      expect(textL).toBeGreaterThan(0.70)
    }
  })
})
