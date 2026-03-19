#!/usr/bin/env node

/**
 * Load the extension in Chrome, navigate to a URL, toggle dark mode on,
 * take before/after screenshots, and report results.
 *
 * Usage:
 *   node scripts/test-extension.js [url]
 *   node scripts/test-extension.js https://www.getharvest.com
 *   node scripts/test-extension.js                              # defaults to getharvest
 *
 * Options:
 *   --headed    Show the browser window (default: headless)
 *   --keep      Keep browser open after screenshots (implies --headed)
 *   --delay=N   Wait N ms after toggling dark mode before screenshot (default: 2000)
 */

import puppeteer from 'puppeteer'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '..')
const SCREENSHOTS_DIR = path.join(EXTENSION_PATH, 'screenshots')

const args = process.argv.slice(2)
const flags = args.filter(a => a.startsWith('--'))
const positional = args.filter(a => !a.startsWith('--'))

const url = positional[0] || 'https://www.getharvest.com'
const headed = flags.includes('--headed') || flags.includes('--keep')
const keep = flags.includes('--keep')
const delayFlag = flags.find(f => f.startsWith('--delay='))
const delay = delayFlag ? parseInt(delayFlag.split('=')[1]) : 2000

async function run() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR)
  }

  const hostname = new URL(url).hostname
  const safeName = hostname.replace(/[^a-z0-9.-]/gi, '_')

  console.log(`Loading extension from: ${EXTENSION_PATH}`)
  console.log(`Testing URL: ${url}`)
  console.log(`Mode: ${headed ? 'headed' : 'headless'}\n`)

  const browser = await puppeteer.launch({
    headless: !headed,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
      '--window-size=1440,900'
    ]
  })

  // Wait for the service worker to register
  const workerTarget = await browser.waitForTarget(
    t => t.type() === 'service_worker' && t.url().includes('service-worker.js'),
    { timeout: 10000 }
  )
  const extensionUrl = workerTarget.url()
  const extensionId = extensionUrl.split('/')[2]
  console.log(`Extension loaded (ID: ${extensionId})`)

  // Get a handle to the service worker so we can call chrome.tabs.sendMessage
  const swPage = await workerTarget.worker()

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  // Navigate to the target URL (follow redirects)
  console.log(`Navigating to ${url}...`)
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  } catch (e) {
    if (e.message.includes('detached')) {
      // Redirect caused frame detach — wait for new page to load
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
    } else {
      throw e
    }
  }
  const finalUrl = page.url()
  console.log(`Final URL: ${finalUrl}`)
  await new Promise(r => setTimeout(r, 1500))

  // Screenshot BEFORE dark mode
  const beforePath = path.join(SCREENSHOTS_DIR, `${safeName}-before.png`)
  await page.screenshot({ path: beforePath, fullPage: false })
  console.log(`Screenshot (before): ${beforePath}`)

  // Toggle dark mode ON:
  // 1. Update storage (so future loads remember)
  // 2. Send message to content script via chrome.tabs.sendMessage (from service worker)
  const tabId = await page.evaluate(() => {
    // Content scripts don't have access to their own tab ID,
    // but we can get it indirectly
    return null
  })

  // Use the service worker to find the tab and send the message
  await swPage.evaluate(async (targetUrl) => {
    // Update storage
    const data = await chrome.storage.sync.get('domains')
    const domains = data.domains || {}
    const hostname = new URL(targetUrl).hostname
    domains[hostname] = true
    await chrome.storage.sync.set({ domains })

    // Find the tab — check active tabs, match broadly
    const tabs = await chrome.tabs.query({})
    // Try matching hostname, then fallback to any http tab that isn't a chrome page
    let tab = tabs.find(t => t.url && t.url.includes(hostname))
    if (!tab) {
      tab = tabs.find(t => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')) && !t.url.includes('chrome'))
    }
    if (tab) {
      // Also update storage for the actual tab hostname (handles redirects)
      const actualHostname = new URL(tab.url).hostname
      if (actualHostname !== hostname) {
        domains[actualHostname] = true
        await chrome.storage.sync.set({ domains })
      }
      await chrome.tabs.sendMessage(tab.id, {
        type: 'toggle-darkmode',
        enabled: true
      })
    } else {
      throw new Error('No suitable tab found. Tabs: ' + tabs.map(t => t.url).join(', '))
    }
  }, url)

  console.log('Dark mode toggled ON via service worker')

  // Wait for dark mode to fully apply
  console.log(`Waiting ${delay}ms for dark mode to render...`)
  await new Promise(r => setTimeout(r, delay))

  // Screenshot AFTER dark mode
  const afterPath = path.join(SCREENSHOTS_DIR, `${safeName}-after.png`)
  await page.screenshot({ path: afterPath, fullPage: false })
  console.log(`Screenshot (after):  ${afterPath}`)

  // Diagnostics
  const diagnostics = await page.evaluate(() => {
    const html = document.documentElement
    return {
      darkModeAttr: html.hasAttribute('data-darkmode'),
      colorScheme: html.style.colorScheme,
      stylesheetInjected: !!document.getElementById('ultimate-darkmode-css'),
      overrideInjected: !!document.getElementById('ultimate-darkmode-override'),
      metaColorScheme: document.querySelector('meta[name="color-scheme"]')?.content || null,
      bodyBg: window.getComputedStyle(document.body).backgroundColor,
      bodyColor: window.getComputedStyle(document.body).color
    }
  })

  console.log('\n--- Diagnostics ---')
  console.log(`Dark mode attr:     ${diagnostics.darkModeAttr}`)
  console.log(`color-scheme:       ${diagnostics.colorScheme}`)
  console.log(`Meta color-scheme:  ${diagnostics.metaColorScheme}`)
  console.log(`Base CSS injected:  ${diagnostics.stylesheetInjected}`)
  console.log(`Site override:      ${diagnostics.overrideInjected}`)
  console.log(`Body background:    ${diagnostics.bodyBg}`)
  console.log(`Body text color:    ${diagnostics.bodyColor}`)

  console.log(`\nScreenshots saved to: ${SCREENSHOTS_DIR}/`)

  if (keep) {
    console.log('\n--keep flag set. Browser stays open. Press Ctrl+C to exit.')
    await new Promise(() => {})
  } else {
    await browser.close()
  }
}

run().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
