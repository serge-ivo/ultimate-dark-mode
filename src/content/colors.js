/**
 * Color analysis and remapping utilities.
 * Pure functions — no DOM or Chrome API dependencies.
 */

/**
 * Parse an rgb/rgba color string into {r, g, b} with values 0-1.
 * Returns null if the string cannot be parsed.
 */
export function parseColor(colorStr) {
  if (!colorStr || typeof colorStr !== 'string') return null
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return null
  return {
    r: parseInt(match[1]) / 255,
    g: parseInt(match[2]) / 255,
    b: parseInt(match[3]) / 255
  }
}

/**
 * Calculate perceptual lightness (relative luminance) of an rgb/rgba string.
 * Returns a value between 0 (black) and 1 (white).
 * Returns 0.5 as fallback for unparseable colors.
 */
export function getColorLightness(colorStr) {
  const c = parseColor(colorStr)
  if (!c) return 0.5
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/**
 * Determine if a color string represents a "light" color (lightness > threshold).
 */
export function isLightColor(colorStr, threshold = 0.6) {
  return getColorLightness(colorStr) > threshold
}

/**
 * Determine if a color string represents a "dark" color (lightness < threshold).
 */
export function isDarkColor(colorStr, threshold = 0.4) {
  return getColorLightness(colorStr) < threshold
}

/**
 * Remap a light background color to a dark equivalent.
 * Maps high lightness (0.6–1.0) into the dark surface range (0.15–0.25).
 * NOT inversion — produces an explicit dark palette value.
 */
export function remapColor(colorStr) {
  const lightness = getColorLightness(colorStr)
  const darkL = 0.15 + (1 - lightness) * 0.25
  return `oklch(${darkL.toFixed(2)} 0.01 260)`
}

/**
 * Remap a dark text color to a light equivalent for dark backgrounds.
 * Maps low lightness (0.0–0.4) into the light text range (0.75–0.90).
 */
export function remapTextColor(colorStr) {
  const lightness = getColorLightness(colorStr)
  const lightL = 0.75 + lightness * 0.38
  return `oklch(${Math.min(lightL, 0.90).toFixed(2)} 0.01 260)`
}

/**
 * Check if a tag name belongs to a media element that should never be altered.
 */
export function isMediaTag(tagName) {
  if (!tagName) return false
  const tag = tagName.toLowerCase()
  return ['img', 'video', 'canvas', 'picture', 'iframe', 'embed', 'object', 'svg'].includes(tag)
}
