const STORAGE_KEY = 'domains'

document.addEventListener('DOMContentLoaded', async () => {
  const domainEl = document.getElementById('domain-name')
  const toggle = document.getElementById('toggle')
  const label = document.getElementById('toggle-label')
  const status = document.getElementById('status')
  const debugLog = document.getElementById('debug-log')

  function log(msg, type = 'info') {
    debugLog.classList.add('active')
    const line = document.createElement('div')
    line.className = `log-line log-${type}`
    line.textContent = msg
    debugLog.appendChild(line)
    debugLog.scrollTop = debugLog.scrollHeight
  }

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    domainEl.textContent = 'Not available on this page'
    toggle.disabled = true
    return
  }

  const url = new URL(tab.url)
  const hostname = url.hostname
  domainEl.textContent = hostname

  // Load current state
  const data = await chrome.storage.sync.get(STORAGE_KEY)
  const domains = data[STORAGE_KEY] || {}
  const isEnabled = domains[hostname] || false

  toggle.checked = isEnabled
  updateUI(isEnabled)

  // Handle toggle
  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked
    domains[hostname] = enabled
    await chrome.storage.sync.set({ [STORAGE_KEY]: domains })

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'toggle-darkmode',
        enabled
      })
    } catch (e) {
      status.textContent = 'Reload page to apply'
    }

    updateUI(enabled)

    await chrome.action.setBadgeText({
      tabId: tab.id,
      text: enabled ? 'ON' : ''
    })
    if (enabled) {
      await chrome.action.setBadgeBackgroundColor({
        tabId: tab.id,
        color: '#6366f1'
      })
    }
  })

  function updateUI(enabled) {
    label.textContent = enabled ? 'On' : 'Off'
    label.classList.toggle('active', enabled)
  }

  // Report issue
  const reportLink = document.getElementById('report-issue')
  const reportStatus = document.getElementById('report-status')

  reportLink.addEventListener('click', async (e) => {
    e.preventDefault()
    reportStatus.textContent = 'Capturing...'
    reportStatus.className = 'report-status'

    log('Starting capture for ' + hostname)

    // 1. Capture debug info
    let debugJson = ''
    try {
      log('Requesting debug info from content script...')
      const debugInfo = await chrome.tabs.sendMessage(tab.id, {
        type: 'capture-debug-info'
      })
      debugJson = JSON.stringify(debugInfo, null, 2)
      const elements = debugInfo.elements?.length || 0
      const classes = debugInfo.topClasses?.length || 0
      const props = Object.keys(debugInfo.cssCustomProperties || {}).length
      const inlines = debugInfo.inlineStyleCount || 0
      log(`Captured: ${elements} elements, ${classes} classes, ${props} CSS vars, ${inlines} inline styles`, 'ok')
    } catch (err) {
      log('Failed to capture debug info: ' + err.message, 'err')
    }

    // 2. Screenshot
    let screenshotDataUrl = ''
    try {
      log('Capturing screenshot...')
      screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' })
      log('Screenshot captured (' + Math.round(screenshotDataUrl.length / 1024) + ' KB)', 'ok')
    } catch (err) {
      log('Screenshot failed: ' + err.message, 'err')
    }

    // 3. Copy everything to clipboard as rich text (screenshot) + plain text (debug JSON)
    // We combine screenshot + debug info into one clipboard write
    let clipboardOk = false
    try {
      log('Copying to clipboard...')
      const items = {}
      if (screenshotDataUrl) {
        const res = await fetch(screenshotDataUrl)
        const blob = await res.blob()
        items['image/png'] = blob
      }
      if (Object.keys(items).length > 0) {
        await navigator.clipboard.write([new ClipboardItem(items)])
        clipboardOk = true
        log('Screenshot copied to clipboard', 'ok')
      }
    } catch (err) {
      log('Clipboard write failed: ' + err.message, 'err')
    }

    // 4. Build issue body with debug info inline
    log('Building issue...')

    // Compact the debug JSON — keep only the most useful fields
    let compactDebug = ''
    if (debugJson) {
      try {
        const parsed = JSON.parse(debugJson)
        const compact = {
          url: parsed.url,
          hostname: parsed.hostname,
          colorScheme: parsed.colorScheme,
          elements: (parsed.elements || []).map(el => ({
            tag: el.tag,
            classes: el.classes?.slice(0, 3),
            styles: {
              bg: el.styles?.backgroundColor,
              color: el.styles?.color
            }
          })),
          topClasses: (parsed.topClasses || []).slice(0, 20),
          cssCustomProperties: parsed.cssCustomProperties,
          inlineStyleCount: parsed.inlineStyleCount,
          inlineStyleSamples: (parsed.inlineStyleSamples || []).slice(0, 5)
        }
        compactDebug = JSON.stringify(compact, null, 2)
        log('Debug info compacted: ' + Math.round(compactDebug.length / 1024) + ' KB', 'ok')
      } catch (err) {
        compactDebug = debugJson.slice(0, 3000)
        log('Using truncated raw debug info', 'info')
      }
    }

    const bodyLines = [
      `### Site URL\n\n${tab.url}`,
      `\n### Screenshot\n\n${clipboardOk ? '*(Screenshot copied to clipboard — paste it below)*' : '*(Please attach a screenshot)*'}`
    ]

    if (compactDebug) {
      bodyLines.push(`\n### Site Debug Info (CSS/DOM)\n\n<details>\n<summary>Click to expand</summary>\n\n\`\`\`json\n${compactDebug}\n\`\`\`\n\n</details>`)
    }

    const title = `[Broken] ${hostname}`
    const body = bodyLines.join('\n')

    // GitHub new issue URL limit is ~8000 chars after encoding
    const maxBodyLen = 4000
    const croppedBody = body.length > maxBodyLen
      ? body.slice(0, maxBodyLen) + '\n```\n\n</details>\n\n*(truncated)*'
      : body

    const issueUrl = `https://github.com/serge-ivo/ultimate-dark-mode/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(croppedBody)}&labels=${encodeURIComponent('site-override,claude')}`

    log('Issue URL: ' + issueUrl.length + ' chars', issueUrl.length > 8000 ? 'err' : 'ok')

    if (clipboardOk) {
      reportStatus.textContent = 'Screenshot copied — paste in issue'
      reportStatus.className = 'report-status copied'
    } else {
      reportStatus.textContent = 'Opening issue...'
    }

    log('Opening GitHub issue...', 'ok')
    chrome.tabs.create({ url: issueUrl })
  })
})
