/**
 * The gateway's own pages, in two languages, checked by rendering them.
 *
 * These pages are written in Chinese and translated at runtime: the markup
 * carries the Chinese, and a table beside it carries the English under keys the
 * elements name. That arrangement has exactly one failure mode, and it is
 * silent — a string with no key of its own simply stays Chinese when someone
 * switches to English, on a page where everything around it changed. Nothing
 * errors, nothing logs, and the only way to find it is to look.
 *
 * So this looks. Each page is rendered, its embedded table is read back out,
 * and every piece of Chinese in the result has to be attached to a key that the
 * table can answer. What it asserts, in order of what actually goes wrong:
 *
 * - Chinese text with no `data-t`/`data-th` on the element holding it.
 * - Chinese in a `placeholder` or `aria-label` with no `data-tp`/`data-ta`.
 * - A key named by the markup that the table does not define.
 * - A key whose two languages are not both present and non-empty.
 * - Markup inside a `data-t` string, which `textContent` would show as tags.
 * - A key the table defines that nothing on the page names.
 *
 * Run: node scripts/check-pages.mjs
 */

import process from 'node:process'

const CJK = /[一-鿿]/

/**
 * The pages, each rendered with enough state to reach every branch it has.
 *
 * State matters here: a page renders different markup for a signed-out visitor
 * than for one holding a half-finished sign-in, and a string only present in
 * one of them is only checkable in one of them.
 */
async function pages() {
  const { policyPage, POLICY_SLUGS } = await import('../gateway/src/policy-page.js')
  const { loginPage } = await import('../gateway/src/login-page.js')
  const { profilePage } = await import('../gateway/src/profile-page.js')
  const { consolePage } = await import('../admin/console-shell.js')
  const { SECTIONS } = await import('../admin/sections/index.js')
  const { PAGE_SIZE } = await import('../admin/sections/paging.js')

  const rendered = []
  for (const slug of POLICY_SLUGS) {
    rendered.push({
      name: `policy/${slug}`,
      group: `policy/${slug}`,
      html: policyPage(slug, { contact: 'ops@example.com', version: '1.2.3' }),
    })
  }
  rendered.push(
    { name: 'login (address)', group: 'login', html: loginPage({ inviteRequired: true, version: '1.2.3' }) },
    { name: 'login (code)', group: 'login', html: loginPage({ pending: 'someone@example.com', version: '1.2.3' }) },
    { name: 'login (error)', group: 'login', html: loginPage({ error: 'code.wrong', inviteRequired: false }) },
    {
      name: 'profile (first)',
      group: 'profile',
      html: profilePage({ email: 'someone@example.com', first: true, avatarLimit: 64_000, nameLimit: 40, version: '1.2.3' }),
    },
    {
      name: 'profile (editing)',
      group: 'profile',
      html: profilePage({
        email: 'someone@example.com', name: 'Someone', error: 'avatar.large',
        avatarLimit: 64_000, nameLimit: 40, version: '1.2.3',
      }),
    },
    // Every section, in two states each: with rows and without. A section is
    // a file now, so the way this check goes stale is a new file nobody added
    // here — which is why it walks `SECTIONS` rather than naming them.
    ...consoleStates(SECTIONS, PAGE_SIZE).map(({ name, section, state }) => {
      const drawn = section.render(state)
      return {
        name: `console/${section.id} (${name})`,
        group: `console/${section.id}`,
        html: consolePage({
          section,
          sections: SECTIONS,
          body: drawn.html,
          table: drawn.table,
          viewer: 'admin',
          notice: undefined,
          version: '1.2.3',
        }),
      }
    }),
  )
  return rendered
}

/**
 * The translation table a rendered page carries.
 *
 * @param {string} html - the rendered page.
 * @returns {{table: Record<string, {en: string, zh: string}>, rest: string}} the table, and the page without it.
 */
function embedded(html) {
  // The vocabulary travels as a JSON island rather than as a line of script,
  // so a page can be handed another section's without reloading. Read the same
  // way the browser reads it.
  const open = '<script type="application/json" id="dsh-strings">'
  const at = html.indexOf(open)
  if (at === -1) return { table: undefined, rest: html }
  const from = at + open.length
  const to = html.indexOf('</script>', from)
  const table = JSON.parse(html.slice(from, to).replaceAll('\\u003c', '<'))
  return { table, rest: html.slice(0, at) + html.slice(to) }
}

/**
 * Text this page is allowed to leave untranslated.
 *
 * The language buttons name each language in its own script, which is the point
 * of them: someone who cannot read the current language has to be able to find
 * the one they can. `<title>` is set from `doc.title` at runtime and its markup
 * is only what a browser shows before the script runs.
 */
const ALLOWED = [/<button type="button" data-lang="zh"[^>]*>/, /<title>/]

const problems = []

/** What each page's states, taken together, name and carry. */
const reachable = new Map()

for (const { name, group, html } of await pages()) {
  const { table, rest: whole } = embedded(html)
  // An element written through innerHTML replaces everything inside it, so its
  // children are already translated by the key on the parent. Emptied rather
  // than skipped, so what surrounds them is still checked.
  const rest = whole.replaceAll(/<([a-z]+)((?:"[^"]*"|[^>"])*data-th="[^"]*"(?:"[^"]*"|[^>"])*)>[\s\S]*?<\/\1>/g, '<$1$2></$1>')
  if (table === undefined) {
    problems.push(`${name}: renders no translation table, so it has no second language at all`)
    continue
  }

  const named = new Set()

  // ---- Chinese in text, and whether the element holding it names a key ----

  for (const match of rest.matchAll(/<([a-z][a-z0-9]*)((?:"[^"]*"|[^>"])*)>([^<]+)/g)) {
    const [whole, , attributes, text] = match
    if (!CJK.test(text)) continue
    if (ALLOWED.some((allowed) => allowed.test(whole))) continue
    const key = /data-(?:t|th)="([^"]+)"/.exec(attributes)
    if (key === null) problems.push(`${name}: “${text.trim().slice(0, 40)}” has no key, so it stays Chinese in English`)
    else named.add(key[1])
  }

  // ---- Chinese in the attributes a reader also sees ----

  for (const match of rest.matchAll(/<([a-z][a-z0-9]*)((?:"[^"]*"|[^>"])*)>/g)) {
    const attributes = match[2]
    // `data-tp` writes the placeholder AND the aria-label, so it satisfies
    // either; `data-ta` writes only the label.
    for (const [attribute, markers] of [['placeholder', ['data-tp']], ['aria-label', ['data-ta', 'data-tp']]]) {
      const value = new RegExp(`${attribute}="([^"]*)"`).exec(attributes)
      if (value === null || !CJK.test(value[1])) continue
      const key = markers.map((marker) => new RegExp(`${marker}="([^"]+)"`).exec(attributes)).find(Boolean)
      if (key === undefined) problems.push(`${name}: ${attribute}="${value[1].slice(0, 30)}" has no ${markers.join(' or ')}`)
      else named.add(key[1])
    }
  }

  // Keys named without Chinese beside them still have to resolve.
  for (const match of rest.matchAll(/data-(?:t|th|tp|ta)="([^"]+)"/g)) named.add(match[1])
  // And the ones a page's own script asks for, which have no element to carry
  // an attribute because they do not exist until something happens.
  for (const match of html.matchAll(/dshText\('([^']+)'\)/g)) named.add(match[1])
  // And the sentence a form asks before it posts, which is named on the form
  // and looked up when the dialog opens.
  for (const match of rest.matchAll(/data-confirm="([^"]+)"/g)) named.add(match[1])

  // ---- the table answers every key, in both languages ----

  for (const key of named) {
    const entry = table[key]
    if (entry === undefined) {
      problems.push(`${name}: ${key} is named by the markup and absent from the table`)
      continue
    }
    for (const lang of ['en', 'zh']) {
      if (typeof entry[lang] !== 'string' || entry[lang].trim() === '') {
        problems.push(`${name}: ${key} has no ${lang}`)
      }
    }
  }

  // A string written through textContent shows its tags as characters.
  for (const match of rest.matchAll(/data-t="([^"]+)"/g)) {
    const entry = table[match[1]]
    if (entry === undefined) continue
    for (const lang of ['en', 'zh']) {
      if (/<[a-z]/i.test(entry[lang] ?? '')) {
        problems.push(`${name}: ${match[1]} carries markup in ${lang} but is written with data-t, which would show the tags`)
      }
    }
  }

  // Held for the pass below: a page has more than one state, and a string only
  // one of them shows is not a string nothing shows.
  const seen = reachable.get(group) ?? { named: new Set(), keys: new Set() }
  for (const key of named) seen.named.add(key)
  for (const key of Object.keys(table)) seen.keys.add(key)
  reachable.set(group, seen)
}

// ---- and nothing the tables carry is unreachable ----

// Across every state of a page, not within one: the console's vocabulary
// covers rows a given deployment may not have, and an empty invite list is not
// evidence that the word for an unused code is dead.
//
// `doc.title` is the tab, which no element names; `theme.label` belongs to a
// control that may not be on every page.
//
// The console's notices are named by neither an element nor a literal in its
// script: the server answers an action with a CODE, and the browser looks that
// code up when it raises the toast. So the set itself is the naming, read from
// the same export the page ships — which keeps this rule sharp for every other
// key rather than blunting it with a page-wide exemption.
const { CONSOLE_NOTICES } = await import('../gateway/src/page-chrome.js')
const BY_CODE = new Set(Object.keys(CONSOLE_NOTICES))

for (const [group, { named, keys }] of reachable) {
  for (const key of keys) {
    if (key === 'doc.title' || key === 'theme.label') continue
    if (group.startsWith('console/') && BY_CODE.has(key)) continue
    if (!named.has(key)) problems.push(`${group}: ${key} is in the table and nothing names it`)
  }
}

// ---- the two languages of each policy document line up ----

const { POLICY_SLUGS, sameShape } = await import('../gateway/src/policy-page.js')
for (const slug of POLICY_SLUGS) problems.push(...sameShape(slug))

// ---- report ----

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\n${problems.length} problem(s) in the gateway's pages`)
  process.exit(1)
}

console.log("check-pages: every string on the gateway's pages carries both languages")

/**
 * Every state of every console section that is worth rendering.
 *
 * Two per section at least — populated and empty — plus the three the security
 * card only reaches mid-enrolment, which is the worst moment to discover a
 * page does not render.
 *
 * @param {Array<object>} SECTIONS - the console's sections, imported where the pages are built.
 * @param {number} PAGE_SIZE - how many rows a page holds.
 * @returns {Array<{name: string, section: object, state: object}>} the cases.
 */
function consoleStates(SECTIONS, PAGE_SIZE) {
  // A page's worth, which is what a section is handed. The store pages in SQL;
  // what is checked here is that the section renders what it was given and
  // draws the control that reaches the rest.
  const tenants = Array.from({ length: PAGE_SIZE }, (unused, index) => ({
    email: `tenant${String(index)}@example.com`,
    id: `a${String(index)}`,
    createdAt: 0,
    lastSeenAt: 0,
    disabled: index % 5 === 0,
    admin: false,
    plan: ['free', 'pro', 'team'][index % 3],
  }))
  const admins = [
    { email: 'root@example.com', id: 'r1', createdAt: 0, lastSeenAt: 0, disabled: false, admin: true, plan: 'team' },
  ]
  const invites = Array.from({ length: PAGE_SIZE }, (unused, index) => ({
    code: `ABCDE-FGHJ${String(index).padStart(1, '0')}`,
    createdAt: 0,
    redeemedAt: index % 2 === 0 ? undefined : 1,
    redeemedBy: index % 2 === 0 ? undefined : 'someone@example.com',
  }))
  const audit = [
    { at: new Date(0), actor: 'admin', action: 'account.suspended', subject: 'someone@example.com', detail: {} },
    { at: new Date(0), actor: 'admin', action: 'something.newer', subject: null, detail: { count: 3 } },
  ]
  const by = (id) => SECTIONS.find((section) => section.id === id)

  return [
    { name: 'a full page', section: by('tenants'), state: { admins, tenants, page: 2, total: 137 } },
    { name: 'empty', section: by('tenants'), state: { admins: [], tenants: [], page: 1, total: 0 } },
    { name: 'a full page', section: by('invites'), state: { invites, page: 2, total: 137 } },
    { name: 'empty', section: by('invites'), state: { invites: [], page: 1, total: 0 } },
    {
      name: 'from the console',
      section: by('settings'),
      state: {
        access: { inviteRequired: true, sandboxLimit: 10, source: 'console', updatedAt: 0, updatedBy: 'admin' },
        credential: { baseUrl: 'https://api.example.com', apiKey: 'sk-abcd1234', source: 'console', updatedAt: 0, updatedBy: 'admin' },
      },
    },
    {
      name: 'from the environment',
      section: by('settings'),
      state: {
        access: { inviteRequired: false, sandboxLimit: 0, source: 'environment', updatedAt: undefined, updatedBy: undefined },
        credential: { baseUrl: '', apiKey: '', source: 'environment', updatedAt: undefined, updatedBy: undefined },
      },
    },
    {
      name: 'off',
      section: by('security'),
      state: { security: { enabled: false, source: 'none', recoveryLeft: 0, updatedAt: undefined, qr: undefined, secret: undefined, freshCodes: undefined } },
    },
    {
      name: 'on',
      section: by('security'),
      state: { security: { enabled: true, source: 'console', recoveryLeft: 7, updatedAt: 0, qr: undefined, secret: undefined, freshCodes: undefined } },
    },
    {
      name: 'enrolling',
      section: by('security'),
      state: {
        security: {
          enabled: false, source: 'none', recoveryLeft: 0, updatedAt: undefined,
          qr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
          secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
          freshCodes: undefined,
        },
      },
    },
    {
      name: 'recovery codes, shown once',
      section: by('security'),
      state: {
        security: {
          enabled: true, source: 'console', recoveryLeft: 10, updatedAt: 0,
          qr: undefined, secret: undefined, freshCodes: ['abcde-fghjk', 'mnpqr-stuvw'],
        },
      },
    },
    { name: 'populated', section: by('audit'), state: { audit, page: 1, total: 2 } },
    { name: 'empty', section: by('audit'), state: { audit: [], page: 1, total: 0 } },
  ]
}
