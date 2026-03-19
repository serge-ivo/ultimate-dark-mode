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
    reportStatus.textContent = 'Capturing site data...'
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

    // 2. Capture screenshot and copy to clipboard
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

    // 3. Upload debug info as a gist so it doesn't bloat the URL
    let gistUrl = ''
    if (debugJson) {
      try {
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
        }
      } catch (err) {
        console.warn('Could not create gist:', err)
      }
    }

    // 4. Build issue body
    const bodyLines = [
      `### Site URL\n\n${tab.url}`,
      `\n### Screenshot\n\n${screenshotCopied ? '*(Screenshot copied to clipboard — paste it here)*' : '*(Please attach a screenshot)*'}`
    ]

    if (gistUrl) {
      bodyLines.push(`\n### Site Debug Info\n\n[CSS/DOM analysis](${gistUrl})`)
    } else if (debugJson) {
      // Fallback: include truncated debug info inline
      const truncated = debugJson.slice(0, 3000)
      bodyLines.push(`\n### Site Debug Info\n\n<details>\n<summary>CSS/DOM analysis</summary>\n\n\`\`\`json\n${truncated}\n\`\`\`\n\n</details>`)
    }

    const title = `[Broken] ${hostname}`
    const body = bodyLines.join('\n')
    const issueUrl = `https://github.com/serge-ivo/ultimate-dark-mode/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body.slice(0, 6000))}&labels=${encodeURIComponent('site-override,claude')}`

    if (screenshotCopied) {
      reportStatus.textContent = 'Screenshot copied — paste in issue'
      reportStatus.className = 'report-status copied'
    } else {
      reportStatus.textContent = 'Opening issue...'
    }

    chrome.tabs.create({ url: issueUrl })
  })
})
