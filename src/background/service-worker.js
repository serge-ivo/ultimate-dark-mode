const STORAGE_KEY = 'domains'

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(STORAGE_KEY, data => {
    if (!data[STORAGE_KEY]) {
      chrome.storage.sync.set({ [STORAGE_KEY]: {} })
    }
  })
})

// Update badge when tab is activated
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateBadge(tabId)
})

// Update badge when tab URL changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateBadge(tabId)
  }
})

async function updateBadge(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab.url) return

    const url = new URL(tab.url)
    const hostname = url.hostname

    const data = await chrome.storage.sync.get(STORAGE_KEY)
    const domains = data[STORAGE_KEY] || {}
    const isEnabled = domains[hostname] || false

    await chrome.action.setBadgeText({
      tabId,
      text: isEnabled ? 'ON' : ''
    })

    if (isEnabled) {
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: '#6366f1'
      })
    }
  } catch (e) {
    // Tab may no longer exist
  }
}
