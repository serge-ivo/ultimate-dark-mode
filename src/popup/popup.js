const STORAGE_KEY = 'domains'

document.addEventListener('DOMContentLoaded', async () => {
  const domainEl = document.getElementById('domain-name')
  const toggle = document.getElementById('toggle')
  const label = document.getElementById('toggle-label')
  const status = document.getElementById('status')

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

  // Report issue — captures screenshot + site CSS debug info
  const reportLink = document.getElementById('report-issue')
  const reportStatus = document.getElementById('report-status')

  reportLink.addEventListener('click', async (e) => {
    e.preventDefault()
    reportStatus.textContent = 'Capturing...'
    reportStatus.className = 'report-status'

    let debugJson = ''

    // 1. Capture site debug info (CSS, DOM structure, computed styles)
    try {
      const debugInfo = await chrome.tabs.sendMessage(tab.id, {
        type: 'capture-debug-info'
      })
      debugJson = JSON.stringify(debugInfo, null, 2)
    } catch (err) {
      console.warn('Could not capture debug info:', err)
    }

    // 2. Capture screenshot
    let screenshotCopied = false
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' })
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
      screenshotCopied = true
    } catch (err) {
      console.warn('Could not capture screenshot:', err)
    }

    // 3. Build issue URL with debug info in body
    const bodyParts = []
    if (debugJson) {
      bodyParts.push('### Site Debug Info\n\n<details>\n<summary>Click to expand CSS/DOM analysis</summary>\n\n```json\n' + debugJson.slice(0, 60000) + '\n```\n\n</details>')
    }

    const issueParams = new URLSearchParams({
      template: 'dark-mode-broken.yml',
      url: tab.url || ''
    })

    // GitHub issue forms don't support pre-filling textarea fields via URL,
    // so we'll create a regular issue with the debug info in the body
    let issueUrl
    if (debugJson) {
      const title = `[Broken] ${hostname}`
      const body = `### Site URL\n\n${tab.url}\n\n### Screenshot\n\n${screenshotCopied ? '*(Screenshot copied to clipboard — paste it here)*' : '*(Please attach a screenshot)*'}\n\n${bodyParts.join('\n\n')}`
      issueUrl = `https://github.com/serge-ivo/ultimate-dark-mode/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('site-override,claude')}`
    } else {
      issueUrl = `https://github.com/serge-ivo/ultimate-dark-mode/issues/new?${issueParams}`
    }

    // Update status
    if (screenshotCopied) {
      reportStatus.textContent = 'Screenshot copied — paste in issue'
      reportStatus.className = 'report-status copied'
    } else {
      reportStatus.textContent = 'Opening issue...'
    }

    chrome.tabs.create({ url: issueUrl })
  })
})
