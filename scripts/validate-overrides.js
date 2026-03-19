#!/usr/bin/env node

/**
 * Validates all site override CSS files against safety rules.
 * Run as part of CI to block bad agent-generated code from merging.
 *
 * Usage:
 *   node scripts/validate-overrides.js              # validate all overrides
 *   node scripts/validate-overrides.js path/to.css  # validate specific file
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OVERRIDES_DIR = path.resolve(__dirname, '..', 'src', 'content', 'overrides')

const args = process.argv.slice(2)
const files = args.length > 0
  ? args
  : fs.readdirSync(OVERRIDES_DIR)
      .filter(f => f.endsWith('.css'))
      .map(f => path.join(OVERRIDES_DIR, f))

let totalErrors = 0
let totalWarnings = 0

for (const file of files) {
  const filename = path.basename(file)
  const css = fs.readFileSync(file, 'utf8')
  const errors = []
  const warnings = []

  // ── SECURITY CHECKS ──────────────────────────────────────────

  // No JavaScript execution vectors
  if (/expression\s*\(/i.test(css)) {
    errors.push('SECURITY: Contains CSS expression() — potential JS execution')
  }
  if (/javascript\s*:/i.test(css)) {
    errors.push('SECURITY: Contains javascript: URL — potential JS execution')
  }
  if (/-moz-binding/i.test(css)) {
    errors.push('SECURITY: Contains -moz-binding — potential XBL injection')
  }
  if (/behavior\s*:/i.test(css)) {
    errors.push('SECURITY: Contains behavior: — potential HTC injection')
  }

  // No external resource loading
  if (/@import/i.test(css)) {
    errors.push('SECURITY: Contains @import — no external resource loading allowed')
  }
  if (/url\s*\(\s*["']?https?:/i.test(css)) {
    errors.push('SECURITY: Contains external URL — no remote resources allowed')
  }
  if (/url\s*\(\s*["']?data:/i.test(css)) {
    // Data URLs can embed scripts in SVGs
    if (/data:image\/svg/i.test(css)) {
      errors.push('SECURITY: Contains data:image/svg URL — potential script injection via SVG')
    } else {
      warnings.push('Contains data: URL — verify it does not embed executable content')
    }
  }

  // No @charset (can be used for encoding attacks)
  if (/@charset/i.test(css)) {
    warnings.push('Contains @charset — usually unnecessary in overrides')
  }

  // ── STRUCTURAL CHECKS ────────────────────────────────────────

  // Must use @layer darkmode.overrides
  if (!css.includes('@layer darkmode.overrides')) {
    errors.push('STRUCTURE: Must wrap all rules in @layer darkmode.overrides { ... }')
  }

  // Must scope with html[data-darkmode]
  // Extract rule selectors (rough parse — look for lines with { that aren't @layer)
  const selectorLines = css.split('\n').filter(line => {
    const trimmed = line.trim()
    return trimmed.includes('{') &&
      !trimmed.startsWith('@') &&
      !trimmed.startsWith('/*') &&
      !trimmed.startsWith('*')
  })

  for (const line of selectorLines) {
    const selector = line.split('{')[0].trim()
    if (selector && !selector.includes('html[data-darkmode]') && !selector.startsWith(':')) {
      errors.push(`STRUCTURE: Selector not scoped with html[data-darkmode]: "${selector.slice(0, 80)}"`)
    }
  }

  // ── BANNED PATTERNS ──────────────────────────────────────────

  // No filter: invert()
  if (/filter\s*:.*invert\s*\(/i.test(css)) {
    errors.push('BANNED: Uses filter: invert() — never invert colors, use explicit remapping')
  }

  // No filter: brightness() on containers (ok on images)
  const brightnessMatches = css.match(/[^}]*filter\s*:.*brightness\s*\([^}]*/gi) || []
  for (const match of brightnessMatches) {
    if (!/img|video|svg|picture/i.test(match)) {
      warnings.push('CAUTION: Uses filter: brightness() — ensure it is only on media elements')
    }
  }

  // No blanket element selectors without class/id qualification
  const broadTags = ['div', 'span', 'p', 'a', 'button', 'input', 'table', 'td', 'tr']
  for (const tag of broadTags) {
    // Match "html[data-darkmode] div {" but not "html[data-darkmode] div.some-class {"
    const pattern = new RegExp(`html\\[data-darkmode\\]\\s+${tag}\\s*\\{`, 'i')
    if (pattern.test(css)) {
      warnings.push(`BROAD: Styles all <${tag}> elements — may conflict with app JS. Prefer class/role selectors`)
    }
  }

  // ── CRASH-RISK CHECKS ────────────────────────────────────────

  // Warn about styling elements apps typically manage
  if (/\[contenteditable/.test(css)) {
    warnings.push('CRASH RISK: Styles contenteditable elements — apps read these styles back')
  }
  if (/\[role="grid"\]/.test(css) && /color\s*:/i.test(css)) {
    warnings.push('CRASH RISK: Sets color on role="grid" — spreadsheet apps may crash')
  }
  if (/canvas/i.test(css) && !/preserve|skip|never/i.test(css)) {
    // Check if canvas is being styled (not just commented about)
    const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    if (/canvas/i.test(cssWithoutComments)) {
      warnings.push('CRASH RISK: References canvas in CSS rules — canvas elements should not be styled')
    }
  }

  // ── SIZE CHECKS ──────────────────────────────────────────────

  if (css.length > 50000) {
    warnings.push(`SIZE: Override is ${Math.round(css.length / 1024)}KB — consider splitting or simplifying`)
  }

  // Count !important usage
  const importantCount = (css.match(/!important/g) || []).length
  if (importantCount > 100) {
    warnings.push(`STYLE: ${importantCount} uses of !important — consider reducing; @layer should handle cascade`)
  }

  // ── REPORT ───────────────────────────────────────────────────

  if (errors.length > 0 || warnings.length > 0) {
    console.log(`\n${filename}:`)
    for (const err of errors) {
      console.log(`  ❌ ${err}`)
      totalErrors++
    }
    for (const warn of warnings) {
      console.log(`  ⚠️  ${warn}`)
      totalWarnings++
    }
  } else {
    console.log(`  ✅ ${filename}`)
  }
}

console.log(`\n${files.length} file(s) checked: ${totalErrors} error(s), ${totalWarnings} warning(s)`)

if (totalErrors > 0) {
  console.log('\n❌ Validation FAILED — fix errors before merging')
  process.exit(1)
} else if (totalWarnings > 0) {
  console.log('\n⚠️  Validation passed with warnings — review before merging')
} else {
  console.log('\n✅ All overrides passed validation')
}
