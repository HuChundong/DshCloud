/**
 * Real-browser boot check.
 *
 * The HTTP and WebSocket suites prove every request answers; they cannot prove
 * the page runs. A frontend that 200s on every asset still fails to boot if an
 * inline script has a syntax error or `window.__DSH_BOOT__` is absent — the
 * bundle is only a shell, and the boot manifest naming its client plugins is
 * injected by the serving dsh host. Both of those reach a person as a blank
 * page and neither shows up in a status code, so this drives a real Chromium
 * and fails on any console error, page error, or failed request.
 *
 * Run from the repository root:
 *   node verify/verify-browser.mjs
 *
 * Playwright is a devDependency of the web frontend workspace and pnpm does
 * not hoist it, so it is resolved from that package rather than imported by
 * bare specifier — this file sits under `verify/`, which has its own
 * package.json and no such dependency.
 */

import { createRequire } from 'node:module'
import process from 'node:process'

// Resolved from THIS directory, which is where `npm install playwright` puts it
// and where verify.sh looks before deciding to run this file. Pointing at the
// repository root made the two disagree: the guard resolved it and this failed
// to require it, so the suite died here instead of skipping.
const require = createRequire(new URL(process.env.PLAYWRIGHT_FROM ?? './package.json', import.meta.url))
const { chromium } = require('playwright')

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const USER = process.env.BROWSER_EMAIL ?? 'delivered+alice@resend.dev'
// Read from the deployment's store by `verify.sh` and handed in, because this
// runs where Chromium is rather than where the database is.
const CODE = process.env.BROWSER_CODE
const SCREENSHOT = process.env.BROWSER_SCREENSHOT

let passed = 0
let failed = 0

/**
 * Record one acceptance result.
 * @param {string} label - what was checked.
 * @param {boolean} ok - whether it held.
 * @param {string} detail - observed value.
 */
function check(label, ok, detail) {
  const mark = ok ? '[32mPASS[0m' : '[31mFAIL[0m'
  console.log(`  ${mark}  ${label.padEnd(46)} ${detail}`)
  if (ok) passed += 1
  else failed += 1
}

const browser = await chromium.launch()
const page = await browser.newPage()

/** Console messages at error level, which a blank page produces and a working one does not. */
const consoleErrors = []
/** Uncaught exceptions, including the syntax errors that stop a script from running at all. */
const pageErrors = []
/** Requests the browser could not complete. */
const failedRequests = []

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => { pageErrors.push(error.message) })
page.on('requestfailed', (request) => {
  failedRequests.push(`${request.url()} — ${request.failure()?.errorText ?? 'failed'}`)
})
page.on('response', (response) => {
  if (response.status() >= 400) failedRequests.push(`${response.url()} — HTTP ${response.status()}`)
})

console.log('\n=== 11. The page boots in a real browser ===')

// Both halves of the real form, driven the way a person drives them: type the
// address, submit, then type the code the page is now asking for. The first
// submit is answered from the cooldown — `verify.sh` has already asked for this
// address's code, which is the one it handed in — and lands on the same second
// state either way.
await page.goto(`${GATEWAY}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', USER)
// The consent box, which is `required`: without this the browser refuses the
// submit and the failure looks like a form that did nothing.
await page.check('input[name="agree"]')
await Promise.all([
  page.waitForSelector('input[name="code"]', { timeout: 30_000 }),
  page.click('button[type="submit"]'),
])
await page.fill('input[name="code"]', CODE ?? '')
await Promise.all([
  page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 180_000 }),
  page.click('button[type="submit"]'),
])
check('signing in lands on the app', !page.url().includes('/login'), page.url())

// The shell mounts before any session exists, so this waits on the app root
// having real content rather than on any particular view.
await page.waitForFunction(
  () => (document.getElementById('root')?.childElementCount ?? 0) > 0,
  undefined,
  { timeout: 180_000 },
).catch(() => {})

const rootChildren = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0)
check('the app root mounted', rootChildren > 0, `${rootChildren} child element(s)`)

const bootRows = await page.evaluate(() => {
  const boot = /** @type {{entries?: unknown[]} | undefined} */ (globalThis.__DSH_BOOT__)
  if (boot === undefined || boot === null) return -1
  return Array.isArray(boot) ? boot.length : Object.keys(boot).length
})
check('window.__DSH_BOOT__ is populated', bootRows > 0, bootRows === -1 ? 'missing' : `${bootRows} field(s)/row(s)`)

check('no uncaught page errors', pageErrors.length === 0, pageErrors[0] ?? 'none')
check('no console errors', consoleErrors.length === 0, consoleErrors[0] ?? 'none')
check('no failed requests', failedRequests.length === 0, failedRequests[0] ?? 'none')

console.log('\n=== 12. A person can hold a conversation ===')

/**
 * Dismiss any dialog standing in front of the app, and wait for it to leave.
 *
 * Called again before each interaction rather than once at the start: a dialog
 * mounts after the shell does, so a single early check can pass while there is
 * nothing on screen and then have one appear and swallow the next click.
 *
 * This deployment retires dsh's opening notice — it says the same thing the
 * sign-in page already says, on a page nobody can skip — so nothing is normally
 * here to dismiss. The step stays because the onboarding queue holds `#root`
 * inert while it runs: a step that renders nothing without completing leaves a
 * blank page nobody can type into, which is what a wrong shadow produced, and
 * only a real browser can tell that apart from a working one.
 *
 * @returns {Promise<boolean>} whether a dialog was dismissed.
 */
async function dismissDialogs() {
  const notice = page.getByRole('button', { name: /continue/i })
  const dismissed = await notice.first().waitFor({ state: 'visible', timeout: 5_000 })
    .then(async () => { await notice.first().click(); return true })
    .catch(() => false)
  await page.waitForFunction(
    () => document.querySelectorAll('[role="presentation"]').length === 0,
    undefined,
    { timeout: 30_000 },
  ).catch(() => {})
  return dismissed
}

const dismissed = await dismissDialogs()
check('no dialog blocks the app', !await page.evaluate(
  () => document.querySelector('#root')?.hasAttribute('inert') ?? false,
), dismissed ? 'dismissed one' : 'none was up')

// A sandbox with no workspace yet keeps the composer read-only until one is
// chosen, through the in-app browser rather than the host's native dialog —
// there is no desktop in a container for a native one to appear on. A sandbox
// that already has one goes straight to the composer, so this runs only when
// it is actually needed.
const composer = page.locator('textarea:not([readonly]), [contenteditable="true"]').first()
const needsWorkspace = await composer.waitFor({ state: 'visible', timeout: 5_000 })
  .then(() => false)
  .catch(() => true)

if (needsWorkspace) {
  await dismissDialogs()
  await page.getByRole('button', { name: /choose workspace/i }).first().click()
  const open = page.getByRole('button', { name: /^open$/i })
  await open.waitFor({ state: 'visible', timeout: 30_000 })
  await open.click()
  await page.waitForFunction(
    () => document.querySelectorAll('[role="presentation"]').length === 0,
    undefined,
    { timeout: 30_000 },
  ).catch(() => {})
  check('a workspace can be chosen in-app', true, 'picked the sandbox home')
}

await composer.waitFor({ state: 'visible', timeout: 60_000 })
await composer.click()
// The expected answer must not appear in the question. Waiting for text the
// prompt itself contains passes the moment the user's own message renders,
// which proves the composer works and nothing about the model.
await composer.fill('What is 17 multiplied by 3? Reply with only the number.')
await page.keyboard.press('Enter')

const answered = await page.getByText('51', { exact: false }).first()
  .waitFor({ state: 'visible', timeout: 180_000 })
  .then(() => true)
  .catch(() => false)
check('the assistant answers in the page', answered, answered ? '51 rendered' : 'no reply within 180s')

if (SCREENSHOT !== undefined) {
  await page.screenshot({ path: SCREENSHOT, fullPage: true })
  console.log(`  screenshot: ${SCREENSHOT}`)
}

if (pageErrors.length > 0) console.log(`\n  page errors:\n${pageErrors.map(e => `    ${e}`).join('\n')}`)
if (consoleErrors.length > 0) console.log(`\n  console errors:\n${consoleErrors.map(e => `    ${e}`).join('\n')}`)
if (failedRequests.length > 0) console.log(`\n  failed requests:\n${failedRequests.map(e => `    ${e}`).join('\n')}`)

await browser.close()

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`)
process.exit(failed === 0 ? 0 : 1)
