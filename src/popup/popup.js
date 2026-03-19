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

    // Send message to content script
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'toggle-darkmode',
        enabled
      })
    } catch (e) {
      // Content script may not be loaded — reload the tab
      status.textContent = 'Reload page to apply'
    }

    updateUI(enabled)

    // Update badge
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
  reportLink.addEventListener('click', async (e) => {
    e.preventDefault()

    const siteUrl = tab.url || ''
    const issueParams = new URLSearchParams({
      template: 'dark-mode-broken.yml',
      url: siteUrl
    })
    const issueUrl = `https://github.com/serge-ivo/ultimate-dark-mode/issues/new?${issueParams}`

    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' })
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
      reportLink.textContent = 'Screenshot copied — paste it in the issue'
      reportLink.classList.add('copied')
    } catch (err) {
      // If screenshot or clipboard fails, still open the issue
      console.warn('Could not capture/copy screenshot:', err)
    }

    chrome.tabs.create({ url: issueUrl })
  })
})
