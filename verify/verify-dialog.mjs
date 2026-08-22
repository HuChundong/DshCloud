/**
 * The confirmation dialog, driven in a real browser.
 *
 * Takes a session rather than signing in for one: what is under test is the
 * dialog, and a test that fails at the sign-in form tells you nothing about it.
 * The suite mints the session against the admin service, which is where the
 * console lives now — it used to be a path on the gateway, reached with a
 * tenant administrator's cookie.
 *
 * Needs PROBE_COOKIES holding an operator session.
 */
import process from 'node:process'
import { chromium } from 'playwright'

const admin = (process.env.ADMIN ?? 'http://localhost:8091').replace(/\/$/, '')
const jar = process.env.PROBE_COOKIES

if (jar === undefined || jar === '') {
  console.error('verify-dialog: PROBE_COOKIES is required')
  process.exit(1)
}

const { hostname } = new URL(admin)
const cookies = jar.split(';').map((pair) => {
  const [name, ...rest] = pair.trim().split('=')
  return { name, value: rest.join('='), domain: hostname, path: '/' }
})

const browser = await chromium.launch()
let failures = 0
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`)
  if (!ok) failures += 1
}

for (const scheme of ['light', 'dark']) {
  // The locale is stated, not inherited. These pages pick their language from
  // `dsh-lang` in storage and fall back to the browser's own, and a fresh
  // context has no storage — so without this the language under test is
  // whatever locale the machine running the suite happens to have, and the
  // assertions below were reading Chinese out of an English page.
  const context = await browser.newContext({ colorScheme: scheme, locale: 'zh-CN', ignoreHTTPSErrors: true })
  await context.addCookies(cookies)
  const page = await context.newPage()
  let native = 0
  page.on('dialog', async (d) => { native += 1; await d.dismiss() })

  await page.goto(admin)
  const remove = page.locator('form[action="/delete"] button').first()
  if (await remove.count() === 0) throw new Error('no deletable account on the console')

  await remove.click()
  await page.waitForSelector('dialog[open]', { timeout: 5_000 })
  const text = await page.locator('dialog[open] p').innerText()
  const background = await page.evaluate(() => getComputedStyle(document.querySelector('dialog[open]')).backgroundColor)

  console.log(`\n=== ${scheme} ===`)
  check('the dialog is the page\'s own, not the browser\'s', native === 0, `native prompts: ${native}`)
  check('it names what will happen', text.includes('删除'), text.slice(0, 34))
  check('it follows the theme', scheme === 'dark' ? background !== 'rgb(255, 255, 255)' : background === 'rgb(255, 255, 255)', background)

  await page.locator('dialog[open] button[value=cancel]').click()
  await page.waitForTimeout(400)
  check('cancelling submits nothing', new URL(page.url()).pathname === '/', page.url())
  check('and closes', await page.locator('dialog[open]').count() === 0)

  // Escape must behave as cancel: the browser gives it for free on <dialog>,
  // and a hand-rolled overlay is where that stops being true.
  await remove.click()
  await page.waitForSelector('dialog[open]', { timeout: 5_000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check('escape cancels too', await page.locator('dialog[open]').count() === 0)

  // The sentence is looked up when the dialog opens rather than rendered with
  // the page, so that someone who switched language after the page loaded is
  // asked in the language they switched to. Nothing else can check that: the
  // string never appears in the served markup, only the key does.
  await page.locator('.lang button[data-lang="en"]').click()
  await page.waitForTimeout(200)
  await remove.click()
  await page.waitForSelector('dialog[open]', { timeout: 5_000 })
  const asked = await page.locator('dialog[open] p').innerText()
  check('and asks in the language chosen since the page loaded', asked.startsWith('Delete '), asked.slice(0, 34))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  await context.close()
}
await browser.close()
console.log(failures === 0 ? '\n弹窗检查全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
