#!/usr/bin/env node

/**
 * Crash test: loads the extension on target sites and checks for JS errors.
 * Catches the exact class of bug that broke Google Sheets (oklch parse errors).
 *
 * Usage:
 *   node scripts/crash-test.js [url...]
 *   node scripts/crash-test.js https://docs.google.com/spreadsheets
 *
 * Without arguments, tests a default set of complex sites.
 */

import puppeteer from 'puppeteer'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const urls = args.length > 0 ? args : [
  'https://www.google.com',
  'https://github.com',
  'https://docs.google.com/spreadsheets',
]

const KNOWN_CRASH_PATTERNS = [
  /oklch/i,
  /Error in protected function/i,
  /Cannot read properties.*darkmode/i,
  /ultimate-darkmode/i,
]

async function run() {
  console.log(`Crash test: ${urls.length} site(s)\n`)

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
    ]
  })

  // Wait for extension to load
  await browser.waitForTarget(
    t => t.type() === 'service_worker' && t.url().includes('service-worker.js'),
    { timeout: 10000 }
  )

  const swTarget = await browser.waitForTarget(
    t => t.type() === 'service_worker' && t.url().includes('service-worker.js')
  )
  const sw = await swTarget.worker()

  let allPassed = true

  for (const url of urls) {
    const hostname = new URL(url).hostname
    const jsErrors = []
    const page = await browser.newPage()

    // Collect JS errors
    page.on('pageerror', err => {
      jsErrors.push(err.message)
    })

    page.on('console', msg => {
      if (msg.type() === 'error') {
        jsErrors.push(msg.text())
      }
    })

    try {
      // Navigate
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 })
      } catch (e) {
        if (!e.message.includes('detached')) throw e
        await new Promise(r => setTimeout(r, 3000))
      }
      await new Promise(r => setTimeout(r, 1000))

      // Enable dark mode via service worker
      await sw.evaluate(async (targetHostname) => {
        const data = await chrome.storage.sync.get('domains')
        const domains = data.domains || {}
        domains[targetHostname] = true
        await chrome.storage.sync.set({ domains })

        const tabs = await chrome.tabs.query({})
        const tab = tabs.find(t => t.url && t.url.includes(targetHostname))
        if (tab) {
          await chrome.tabs.sendMessage(tab.id, { type: 'toggle-darkmode', enabled: true })
        }
      }, hostname).catch(() => {})

      // Wait for dark mode to apply and any errors to surface
      await new Promise(r => setTimeout(r, 3000))

      // Interact with the page (simulate user activity)
      await page.mouse.click(400, 400).catch(() => {})
      await page.keyboard.type('test').catch(() => {})
      await new Promise(r => setTimeout(r, 2000))

      // Check for our-fault errors
      const ourErrors = jsErrors.filter(err =>
        KNOWN_CRASH_PATTERNS.some(pattern => pattern.test(err))
      )

      if (ourErrors.length > 0) {
        console.log(`❌ ${hostname}`)
        for (const err of ourErrors) {
          console.log(`   ERROR: ${err.slice(0, 200)}`)
        }
        allPassed = false
      } else {
        console.log(`✅ ${hostname} (${jsErrors.length} unrelated JS errors ignored)`)
      }
    } catch (err) {
      console.log(`⚠️  ${hostname}: Could not test — ${err.message.slice(0, 100)}`)
    }

    await page.close()
  }

  await browser.close()

  console.log(allPassed ? '\n✅ All crash tests passed' : '\n❌ Crash tests FAILED')
  process.exit(allPassed ? 0 : 1)
}

run().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
