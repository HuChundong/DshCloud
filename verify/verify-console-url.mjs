/**
 * What the address bar does when an administrator acts.
 *
 * An action is a request. Posting a form makes it a destination instead: the
 * outcome lands in the query string and a refresh replays a notice for
 * something that happened once. Only a browser can show that, so this drives
 * one — a status code cannot tell a navigation from a fetch.
 *
 * Needs PROBE_EMAIL and PROBE_COOKIES; run from the acceptance suite.
 */

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'

const gateway = process.env.GATEWAY ?? 'http://localhost:8080'
const cookies = process.env.PROBE_COOKIES

if (cookies === undefined || cookies === '') {
  console.error('verify-console-url: PROBE_COOKIES is required')
  process.exit(1)
}

let failures = 0

/**
 * Report one expectation.
 * @param {string} label - what was expected.
 * @param {unknown} expected - the value wanted.
 * @param {unknown} actual - the value seen.
 */
function check(label, expected, actual) {
  try {
    assert.deepEqual(actual, expected)
    console.log(`  PASS  ${label}  ${String(actual).slice(0, 60)}`)
  } catch {
    failures += 1
    console.log(`  FAIL  ${label}  expected ${String(expected)}, got ${String(actual)}`)
  }
}

const browser = await chromium.launch()
const context = await browser.newContext({ ignoreHTTPSErrors: true })

const url = new URL(gateway)
await context.addCookies(cookies.split(';').map((pair) => {
  const [name, ...rest] = pair.trim().split('=')
  return { name, value: rest.join('='), domain: url.hostname, path: '/' }
}))

const page = await context.newPage()
await page.goto(`${gateway}/admin`, { waitUntil: 'domcontentloaded' })
check('the console loads', true, page.url().endsWith('/admin'))

// Minting invites is the reversible action, so it can be driven repeatedly
// without asking anything of the accounts on the page.
const before = await page.locator('form.mint').count()
if (before === 0) {
  console.error('verify-console-url: no mint form on the console')
  await browser.close()
  process.exit(1)
}

const navigations = []
page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()) })

await page.locator('form.mint button[type=submit]').first().click()
await page.waitForTimeout(1500)

check('the address bar did not change', `${gateway}/admin`, page.url())
check('nothing navigated', 0, navigations.length)
check('the outcome was announced', true, await page.locator('.toast').count() > 0)

// The reason the query string mattered: it survives a refresh and says again
// what was already said.
await page.reload({ waitUntil: 'domcontentloaded' })
check('a refresh lands on a clean console', `${gateway}/admin`, page.url())
check('and repeats nothing', 0, await page.locator('.toast').count())

await browser.close()
console.log(failures === 0 ? '\n控制台 URL 检查全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
