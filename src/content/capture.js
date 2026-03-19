/**
 * Capture site debug info for the AI agent.
 * Collects DOM structure, computed styles, and CSS rules
 * so the agent can generate accurate overrides without needing login access.
 */

function captureSiteDebugInfo() {
  const info = {
    url: window.location.href,
    hostname: window.location.hostname,
    title: document.title,
    timestamp: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    colorScheme: {
      meta: document.querySelector('meta[name="color-scheme"]')?.content || null,
      rootStyle: document.documentElement.style.colorScheme || null,
      prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches
    },
    elements: [],
    stylesheets: []
  }

  // Capture computed styles of key elements
  const selectors = [
    'html', 'body',
    'header', 'nav', 'main', 'footer', 'aside',
    '[role="banner"]', '[role="navigation"]', '[role="main"]',
    'h1', 'h2', 'h3',
    'a', 'button', 'input', 'textarea', 'select',
    'table', 'th', 'td',
    'pre', 'code'
  ]

  const seen = new Set()

  for (const selector of selectors) {
    const els = document.querySelectorAll(selector)
    for (let i = 0; i < Math.min(els.length, 3); i++) {
      const el = els[i]
      const key = el.tagName + '.' + (el.className || '').toString().slice(0, 50)
      if (seen.has(key)) continue
      seen.add(key)

      const computed = window.getComputedStyle(el)
      info.elements.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: (el.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 10),
        role: el.getAttribute('role') || null,
        styles: {
          backgroundColor: computed.backgroundColor,
          color: computed.color,
          borderColor: computed.borderColor,
          fontSize: computed.fontSize,
          fontFamily: computed.fontFamily.split(',')[0].trim()
        }
      })
    }
  }

  // Capture class names used on the page (top-level structural)
  const classMap = {}
  const structuralEls = document.querySelectorAll('body > *, body > * > *, body > * > * > *')
  for (const el of structuralEls) {
    const classes = (el.className || '').toString().split(/\s+/).filter(Boolean)
    for (const cls of classes) {
      if (!classMap[cls]) classMap[cls] = 0
      classMap[cls]++
    }
  }
  // Keep top 50 most-used classes
  info.topClasses = Object.entries(classMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([cls, count]) => ({ class: cls, count }))

  // Capture inline stylesheets (not external — those are CORS-blocked)
  for (const sheet of document.styleSheets) {
    try {
      if (!sheet.href && sheet.cssRules) {
        const rules = []
        for (let i = 0; i < Math.min(sheet.cssRules.length, 100); i++) {
          const rule = sheet.cssRules[i]
          if (rule.cssText.includes('background') ||
              rule.cssText.includes('color') ||
              rule.cssText.includes('border') ||
              rule.cssText.includes('--')) {
            rules.push(rule.cssText.slice(0, 500))
          }
        }
        if (rules.length > 0) {
          info.stylesheets.push({
            type: 'inline',
            colorRules: rules.slice(0, 50)
          })
        }
      }
    } catch (e) {
      // CORS — can't read cross-origin stylesheets
    }
  }

  // Capture CSS custom properties on :root
  const rootStyles = window.getComputedStyle(document.documentElement)
  const customProps = {}
  for (const prop of rootStyles) {
    if (prop.startsWith('--') && (
      prop.includes('color') || prop.includes('bg') ||
      prop.includes('background') || prop.includes('text') ||
      prop.includes('border') || prop.includes('surface') ||
      prop.includes('primary') || prop.includes('secondary')
    )) {
      customProps[prop] = rootStyles.getPropertyValue(prop).trim()
    }
  }
  info.cssCustomProperties = customProps

  // Capture elements with inline styles (these are what Layer 3 needs to handle)
  const inlineStyleEls = document.querySelectorAll('[style]')
  info.inlineStyleCount = inlineStyleEls.length
  info.inlineStyleSamples = []
  for (let i = 0; i < Math.min(inlineStyleEls.length, 20); i++) {
    const el = inlineStyleEls[i]
    const style = el.getAttribute('style')
    if (style && (style.includes('background') || style.includes('color'))) {
      info.inlineStyleSamples.push({
        tag: el.tagName.toLowerCase(),
        classes: (el.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 5),
        style: style.slice(0, 300)
      })
    }
  }

  return info
}

// Export for content script message handling
if (typeof globalThis !== 'undefined') {
  globalThis.__captureSiteDebugInfo = captureSiteDebugInfo
}
