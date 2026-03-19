;(async function () {
  // In Chrome extension context, we can't use ES module imports in content scripts.
  // The color utilities are duplicated here from colors.js (which is the testable source of truth).
  // If you update color logic, update colors.js first, then sync here.

  const STORAGE_KEY = 'domains'
  const ATTR = 'data-darkmode'
  const hostname = window.location.hostname

  if (!hostname) return

  let linkEl = null
  let overrideLinkEl = null
  let observer = null

  // Check stored state immediately
  try {
    const data = await chrome.storage.sync.get(STORAGE_KEY)
    const domains = data[STORAGE_KEY] || {}
    if (domains[hostname]) {
      applyDarkMode()
    }
  } catch (e) {
    // Extension context may be invalidated — fail silently
  }

  // Listen for toggle messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'toggle-darkmode') {
      if (msg.enabled) {
        applyDarkMode()
      } else {
        removeDarkMode()
      }
      sendResponse({ ok: true })
    }
    if (msg.type === 'get-status') {
      sendResponse({
        enabled: document.documentElement.hasAttribute(ATTR)
      })
    }
    if (msg.type === 'capture-debug-info') {
      const info = globalThis.__captureSiteDebugInfo
        ? globalThis.__captureSiteDebugInfo()
        : { error: 'capture.js not loaded' }
      sendResponse(info)
    }
    return true
  })

  function applyDarkMode() {
    if (document.documentElement.hasAttribute(ATTR)) return

    // Layer 1: Force dark color scheme for native support
    document.documentElement.setAttribute(ATTR, '')
    document.documentElement.style.colorScheme = 'dark'

    // Add meta tag to signal dark preference
    let meta = document.querySelector('meta[name="color-scheme"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'color-scheme'
      document.head?.appendChild(meta)
    }
    meta.content = 'dark'

    // Layer 2: Inject dark mode stylesheet
    injectStylesheet()

    // Layer 2.5: Inject site-specific override if available
    injectOverride()

    // Layer 3: JS-assisted — handle inline styles and dynamic content
    setupObserver()
  }

  function removeDarkMode() {
    // Remove attribute
    document.documentElement.removeAttribute(ATTR)
    document.documentElement.style.colorScheme = ''

    // Remove meta
    const meta = document.querySelector('meta[name="color-scheme"]')
    if (meta) meta.remove()

    // Remove stylesheets
    if (linkEl) {
      linkEl.remove()
      linkEl = null
    }
    if (overrideLinkEl) {
      overrideLinkEl.remove()
      overrideLinkEl = null
    }

    // Disconnect observer
    if (observer) {
      observer.disconnect()
      observer = null
    }

    // Revert inline style overrides
    document.querySelectorAll('[data-darkmode-inline]').forEach(el => {
      el.style.backgroundColor = el.dataset.darkmodeOrigBg || ''
      el.style.color = el.dataset.darkmodeOrigColor || ''
      el.removeAttribute('data-darkmode-inline')
      delete el.dataset.darkmodeOrigBg
      delete el.dataset.darkmodeOrigColor
    })
  }

  function injectStylesheet() {
    if (linkEl) return

    linkEl = document.createElement('link')
    linkEl.rel = 'stylesheet'
    linkEl.type = 'text/css'
    linkEl.href = chrome.runtime.getURL('styles/darkmode.css')
    linkEl.id = 'ultimate-darkmode-css'

    // Insert as early as possible
    const target = document.head || document.documentElement
    target.insertBefore(linkEl, target.firstChild)
  }

  function getBaseDomain(host) {
    // "rocketlab.harvestapp.com" → "harvestapp.com"
    // "www.getharvest.com" → "getharvest.com"
    // "harvestapp.com" → "harvestapp.com"
    const parts = host.split('.')
    if (parts.length <= 2) return host
    return parts.slice(-2).join('.')
  }

  function injectOverride() {
    if (overrideLinkEl) return

    // Try exact hostname first, then base domain
    // e.g. "rocketlab.harvestapp.com" → try that, then "harvestapp.com"
    const candidates = [hostname]
    const baseDomain = getBaseDomain(hostname)
    if (baseDomain !== hostname) {
      candidates.push(baseDomain)
    }

    tryNextOverride(candidates, 0)
  }

  function tryNextOverride(candidates, index) {
    if (index >= candidates.length) return

    const candidate = candidates[index]
    const overrideUrl = chrome.runtime.getURL(`src/content/overrides/${candidate}.css`)

    fetch(overrideUrl, { method: 'HEAD' })
      .then(response => {
        if (response.ok) {
          overrideLinkEl = document.createElement('link')
          overrideLinkEl.rel = 'stylesheet'
          overrideLinkEl.type = 'text/css'
          overrideLinkEl.href = overrideUrl
          overrideLinkEl.id = 'ultimate-darkmode-override'

          const target = document.head || document.documentElement
          target.appendChild(overrideLinkEl)
        } else {
          // Try next candidate
          tryNextOverride(candidates, index + 1)
        }
      })
      .catch(() => {
        tryNextOverride(candidates, index + 1)
      })
  }

  function setupObserver() {
    if (observer) return

    // Wait for body to exist
    if (!document.body) {
      const bodyObserver = new MutationObserver(() => {
        if (document.body) {
          bodyObserver.disconnect()
          processExistingElements()
          startMutationObserver()
        }
      })
      bodyObserver.observe(document.documentElement, { childList: true })
    } else {
      processExistingElements()
      startMutationObserver()
    }
  }

  let processPending = false

  function startMutationObserver() {
    observer = new MutationObserver(() => {
      // Debounce: batch mutations into a single rAF pass
      if (processPending) return
      processPending = true
      requestAnimationFrame(() => {
        processPending = false
        processExistingElements()
      })
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true
    })
  }

  function processExistingElements() {
    // Process elements with inline background styles
    // Skip canvas-heavy apps (Google Sheets, etc.) — they handle their own rendering
    const els = document.querySelectorAll('[style]')
    // Cap to avoid freezing complex apps
    const limit = Math.min(els.length, 200)
    for (let i = 0; i < limit; i++) {
      processElement(els[i])
    }
  }

  function processElement(el) {
    if (!document.documentElement.hasAttribute(ATTR)) return
    if (el.hasAttribute('data-darkmode-inline')) return
    if (isMediaElement(el)) return

    // Skip elements inside canvas containers or editor areas
    // These are managed by the app and modifying their styles causes crashes
    if (el.closest('canvas, [role="grid"], [role="textbox"], [contenteditable="true"]')) return

    const inlineStyle = el.getAttribute('style')
    if (!inlineStyle) return

    // Only process elements with inline background-color or color
    const hasBg = inlineStyle.includes('background')
    const hasColor = inlineStyle.includes('color') && !inlineStyle.includes('background-color')

    if (!hasBg && !hasColor) return

    // Pause observer while modifying styles to prevent loops
    if (observer) observer.disconnect()

    try {
      const computed = window.getComputedStyle(el)

      if (hasBg) {
        const bg = computed.backgroundColor
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
          if (getColorLightness(bg) > 0.6) {
            el.dataset.darkmodeOrigBg = el.style.backgroundColor
            el.dataset.darkmodeInline = ''
            el.style.backgroundColor = remapColor(bg)
          }
        }
      }

      if (hasColor) {
        const color = computed.color
        if (color) {
          if (getColorLightness(color) < 0.4) {
            el.dataset.darkmodeOrigColor = el.style.color
            el.dataset.darkmodeInline = ''
            el.style.color = remapTextColor(color)
          }
        }
      }
    } finally {
      // Re-attach observer
      if (observer && document.body) {
        observer.observe(document.body, { childList: true, subtree: true })
      }
    }
  }

  function isMediaElement(el) {
    const tag = el.tagName?.toLowerCase()
    return ['img', 'video', 'canvas', 'picture', 'iframe', 'embed', 'object', 'svg'].includes(tag)
  }

  // Color utilities — kept in sync with src/content/colors.js (the testable source)
  function getColorLightness(colorStr) {
    const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!match) return 0.5
    const r = parseInt(match[1]) / 255
    const g = parseInt(match[2]) / 255
    const b = parseInt(match[3]) / 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  function remapColor(colorStr) {
    const lightness = getColorLightness(colorStr)
    const darkL = 0.15 + (1 - lightness) * 0.25
    return `oklch(${darkL.toFixed(2)} 0.01 260)`
  }

  function remapTextColor(colorStr) {
    const lightness = getColorLightness(colorStr)
    const lightL = 0.75 + lightness * 0.38
    return `oklch(${Math.min(lightL, 0.90).toFixed(2)} 0.01 260)`
  }
})()
