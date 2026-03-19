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
    let screenshotCopied = false
    try {
      log('Capturing screenshot...')
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' })
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
      screenshotCopied = true
      log('Screenshot copied to clipboard (' + Math.round(blob.size / 1024) + ' KB)', 'ok')
    } catch (err) {
      log('Screenshot failed: ' + err.message, 'err')
    }

    // 3. Upload debug info as gist
    let gistUrl = ''
    if (debugJson) {
      try {
        log('Uploading debug info to gist (' + Math.round(debugJson.length / 1024) + ' KB)...')
        const resp = await fetch('https://api.github.com/gists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: `Dark mode debug info for ${hostname}`,
            public: true,
            files: {
              [`${hostname}-debug.json`]: { content: debugJson }
            }
          })
        })
        if (resp.ok) {
          const gist = await resp.json()
          gistUrl = gist.html_url
          log('Gist created: ' + gistUrl, 'ok')
        } else {
          const errText = await resp.text()
          log('Gist upload failed (' + resp.status + '): ' + errText.slice(0, 100), 'err')
        }
      } catch (err) {
        log('Gist upload error: ' + err.message, 'err')
      }
    }

    // 4. Build issue
    log('Building issue URL...')
    const bodyLines = [
      `### Site URL\n\n${tab.url}`,
      `\n### Screenshot\n\n${screenshotCopied ? '*(Screenshot copied to clipboard — paste it here)*' : '*(Please attach a screenshot)*'}`
    ]

    if (gistUrl) {
      bodyLines.push(`\n### Site Debug Info\n\n[CSS/DOM analysis](${gistUrl})`)
    } else if (debugJson) {
      // Truncated fallback
      const truncated = debugJson.slice(0, 2000)
      bodyLines.push(`\n### Site Debug Info\n\n<details>\n<summary>CSS/DOM analysis (truncated)</summary>\n\n\`\`\`json\n${truncated}\n\`\`\`\n\n</details>`)
      log('Using truncated inline debug info (gist failed)', 'info')
    }

    const title = `[Broken] ${hostname}`
    const body = bodyLines.join('\n')

    // Crop body to fit URL limits
    const maxBodyLen = 5000
    const croppedBody = body.length > maxBodyLen
      ? body.slice(0, maxBodyLen) + '\n\n*(truncated — see gist for full data)*'
      : body

    const issueUrl = `https://github.com/serge-ivo/ultimate-dark-mode/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(croppedBody)}&labels=${encodeURIComponent('site-override,claude')}`

    log('Issue URL length: ' + issueUrl.length + ' chars', issueUrl.length > 8000 ? 'err' : 'ok')

    if (screenshotCopied) {
      reportStatus.textContent = 'Screenshot copied — paste in issue'
      reportStatus.className = 'report-status copied'
    } else {
      reportStatus.textContent = 'Opening issue...'
    }

    log('Opening GitHub issue...', 'ok')
    chrome.tabs.create({ url: issueUrl })
  })
})
