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

    const logs = []
    function addLog(msg, type = 'info') {
      log(msg, type)
      logs.push(`[${type}] ${msg}`)
    }

    addLog('Starting capture for ' + hostname)

    // 1. Capture debug info — try content script first, inject if not available
    let debugJson = ''
    try {
      addLog('Requesting debug info from content script...')
      const debugInfo = await chrome.tabs.sendMessage(tab.id, {
        type: 'capture-debug-info'
      })
      debugJson = JSON.stringify(debugInfo, null, 2)
      const elements = debugInfo.elements?.length || 0
      const classes = debugInfo.topClasses?.length || 0
      const props = Object.keys(debugInfo.cssCustomProperties || {}).length
      const inlines = debugInfo.inlineStyleCount || 0
      addLog(`Captured: ${elements} elements, ${classes} classes, ${props} CSS vars, ${inlines} inline styles`, 'ok')
    } catch (err) {
      addLog('Content script not loaded, injecting capture script...', 'info')
      try {
        // Inject capture.js and run it directly
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/content/capture.js']
        })
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => globalThis.__captureSiteDebugInfo()
        })
        if (results?.[0]?.result) {
          const debugInfo = results[0].result
          debugJson = JSON.stringify(debugInfo, null, 2)
          const elements = debugInfo.elements?.length || 0
          const classes = debugInfo.topClasses?.length || 0
          const props = Object.keys(debugInfo.cssCustomProperties || {}).length
          const inlines = debugInfo.inlineStyleCount || 0
          addLog(`Injected & captured: ${elements} elements, ${classes} classes, ${props} CSS vars, ${inlines} inline styles`, 'ok')
        }
      } catch (injectErr) {
        addLog('Inject failed: ' + injectErr.message, 'err')
      }
    }

    // 2. Screenshot
    let screenshotDataUrl = ''
    try {
      addLog('Capturing screenshot...')
      screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' })
      addLog('Screenshot captured (' + Math.round(screenshotDataUrl.length / 1024) + ' KB)', 'ok')
    } catch (err) {
      addLog('Screenshot failed: ' + err.message, 'err')
    }

    // 3. Copy screenshot to clipboard
    let clipboardOk = false
    try {
      if (screenshotDataUrl) {
        const res = await fetch(screenshotDataUrl)
        const blob = await res.blob()
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        clipboardOk = true
        addLog('Screenshot copied to clipboard', 'ok')
      }
    } catch (err) {
      addLog('Clipboard write failed: ' + err.message, 'err')
    }

    // 4. Compact debug JSON — very aggressive, only what the agent needs
    let compactDebug = ''
    if (debugJson) {
      try {
        const parsed = JSON.parse(debugJson)
        const compact = {
          hostname: parsed.hostname,
          colorScheme: parsed.colorScheme,
          // Only elements with non-transparent backgrounds
          elements: (parsed.elements || [])
            .filter(el => el.styles?.backgroundColor && el.styles.backgroundColor !== 'rgba(0, 0, 0, 0)')
            .slice(0, 10)
            .map(el => `${el.tag}.${(el.classes || []).join('.')} bg:${el.styles.backgroundColor} c:${el.styles.color}`),
          classes: (parsed.topClasses || []).slice(0, 10).map(c => c.class),
          cssVars: Object.keys(parsed.cssCustomProperties || {}).slice(0, 10),
          inlineStyles: parsed.inlineStyleCount || 0
        }
        compactDebug = JSON.stringify(compact)
        addLog('Debug compacted: ' + compactDebug.length + ' chars', 'ok')
      } catch (err) {
        addLog('Debug compact failed', 'err')
      }
    }

    // 5. Save full debug data to storage for later retrieval
    if (debugJson) {
      try {
        await chrome.storage.local.set({
          lastDebugCapture: {
            hostname,
            timestamp: Date.now(),
            data: debugJson
          }
        })
        addLog('Full debug data saved to extension storage', 'ok')
      } catch (err) {
        addLog('Storage save failed: ' + err.message, 'err')
      }
    }

    // 6. Build issue body — keep it small for URL
    const title = `[Broken] ${hostname}`
    let body = `### Site URL\n\n${tab.url}\n`
    body += `\n### Screenshot\n\n${clipboardOk ? '*(Screenshot copied to clipboard — paste it here)*' : '*(Please attach a screenshot)*'}\n`

    if (compactDebug) {
      body += `\n### Site Debug Info\n\n\`\`\`json\n${compactDebug}\n\`\`\`\n`
    }

    body += `\n### Capture Log\n\n\`\`\`\n${logs.join('\n')}\n\`\`\``

    // Measure encoded URL length and trim if needed
    const maxUrl = 7500
    let issueUrl = `https://github.com/serge-ivo/ultimate-dark-mode/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('site-override,claude')}`

    if (issueUrl.length > maxUrl) {
      // Drop debug info, keep just URL + screenshot + log
      addLog('URL too long (' + issueUrl.length + '), trimming debug info', 'info')
      body = `### Site URL\n\n${tab.url}\n`
      body += `\n### Screenshot\n\n${clipboardOk ? '*(Screenshot copied to clipboard — paste it here)*' : '*(Please attach a screenshot)*'}\n`
      body += `\n### Site Debug Info\n\nFull debug data captured — stored in extension. Use browser console on extension page:\n\`chrome.storage.local.get('lastDebugCapture', r => console.log(r))\`\n`
      body += `\n### Capture Log\n\n\`\`\`\n${logs.join('\n')}\n\`\`\``
      issueUrl = `https://github.com/serge-ivo/ultimate-dark-mode/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('site-override,claude')}`
    }

    addLog('Final URL: ' + issueUrl.length + ' chars', issueUrl.length > maxUrl ? 'err' : 'ok')

    if (clipboardOk) {
      reportStatus.textContent = 'Screenshot copied — paste in issue'
      reportStatus.className = 'report-status copied'
    } else {
      reportStatus.textContent = 'Opening issue...'
    }

    chrome.tabs.create({ url: issueUrl })
  })
})
