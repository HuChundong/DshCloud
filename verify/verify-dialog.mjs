/**
 * The confirmation dialog, driven in a real browser.
 *
 * Signs in over HTTP and hands the cookies to the browser, because what is
 * under test is the dialog rather than the form that leads to it — and a test
 * that fails at sign-in tells you nothing about the dialog.
 */
import process from 'node:process'
import { chromium } from 'playwright'

const { GATEWAY = 'https://chat.tempvm.com:8443', PROBE_EMAIL, PROBE_CODE } = process.env

const form = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body),
  redirect: 'manual',
})
// The version the form is asking people to accept, read off the form: signing
// in over HTTP still has to say what a browser would have ticked.
const agree = (await (await fetch(`${GATEWAY}/login`)).text()).match(/name="agree" value="([^"]*)"/)?.[1]
const response = await fetch(`${GATEWAY}/login`, form({ email: PROBE_EMAIL, code: PROBE_CODE, agree }))
const setCookie = response.headers.getSetCookie?.() ?? []
if (setCookie.length === 0) throw new Error(`sign-in failed: HTTP ${response.status}`)

const { hostname } = new URL(GATEWAY)
const cookies = setCookie.map((raw) => {
  const [pair] = raw.split(';')
  const index = pair.indexOf('=')
  return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: hostname, path: '/' }
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

  await page.goto(`${GATEWAY}/admin`)
  const remove = page.locator('form[action="/admin/delete"] button').first()
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
  check('cancelling submits nothing', new URL(page.url()).pathname === '/admin', page.url())
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
