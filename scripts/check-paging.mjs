/**
 * No list section renders an unbounded list.
 *
 * Not a style rule. An unbounded table is a page whose height is decided by
 * the deployment's success: it lays out fine on the machine it was built on,
 * and the day a tenant list reaches four figures it is a document that takes a
 * second to render, a scrollbar that measures the table instead of the page,
 * and a query that read every row to show the twenty somebody was looking at.
 * All three arrive together, on the deployment least able to absorb them.
 *
 * So this hands every section twice what a page holds and requires that a
 * page comes back — and that the control which reaches the rest came with it.
 * A section added later either pages or turns this red.
 *
 * A section that renders no rows at all is not a list section and is skipped;
 * what it is checked for instead is that it did not quietly grow a table.
 */

import process from 'node:process'

const { SECTIONS } = await import('../admin/sections/index.js')
const { PAGE_SIZE } = await import('../admin/sections/paging.js')

/** Twice a page, so a section that ignores the window is obvious. */
const TOO_MANY = PAGE_SIZE * 2

/**
 * The state one section is handed, with more rows than it may show.
 *
 * Keyed by what the section declares it needs, so a new section is covered by
 * naming its store rather than by being added here.
 *
 * @param {object} section - the section.
 * @returns {object|undefined} the state, or nothing when it lists nothing.
 */
function overfill(section) {
  const needs = new Set(section.needs)
  const state = { page: 1, total: 500 }

  if (needs.has('accounts')) {
    state.admins = []
    state.tenants = Array.from({ length: TOO_MANY }, (unused, index) => ({
      email: `t${String(index)}@example.com`,
      id: `a${String(index)}`,
      createdAt: 0,
      lastSeenAt: 0,
      disabled: false,
      admin: false,
      plan: 'free',
    }))
    return state
  }
  if (needs.has('invites')) {
    state.invites = Array.from({ length: TOO_MANY }, (unused, index) => ({
      code: `AAAAA-BBBB${String(index % 10)}`,
      createdAt: 0,
      redeemedAt: undefined,
      redeemedBy: undefined,
    }))
    return state
  }
  if (needs.has('audit')) {
    state.audit = Array.from({ length: TOO_MANY }, () => ({
      at: new Date(0), actor: 'admin', action: 'account.suspended', subject: 'x@example.com', detail: {},
    }))
    return state
  }
  return undefined
}

const problems = []

for (const section of SECTIONS) {
  const state = overfill(section)

  if (state === undefined) {
    // Not a list today. If it grows rows, it has to grow a window with them.
    const drawn = section.render(sparse(section))
    if (/<tbody>/.test(drawn.html)) {
      problems.push(`${section.id} renders a table and is not in check-paging's overfill map`)
    }
    continue
  }

  const drawn = section.render(state)

  // Rows the section chose to draw. Counted as `<tr>` inside the body, which is
  // what a row is here — the header row lives in `<thead>`.
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(drawn.html)
  const rows = body === null ? 0 : (body[1].match(/<tr>/g) ?? []).length

  if (rows > PAGE_SIZE) {
    problems.push(
      `${section.id} drew ${String(rows)} rows from ${String(TOO_MANY)} — a list section shows one page`,
    )
  }
  if (!drawn.html.includes('class="pager"')) {
    problems.push(`${section.id} lists rows and draws no pager, so nothing reaches the rest of them`)
  }
}

/**
 * A state with nothing in it, for a section that lists nothing.
 *
 * @param {object} section - the section.
 * @returns {object} enough to render it.
 */
function sparse(section) {
  const needs = new Set(section.needs)
  const state = { page: 1, total: 0 }
  if (needs.has('access')) state.access = { inviteRequired: false, sandboxLimit: 0, source: 'environment' }
  if (needs.has('credential')) state.credential = { baseUrl: '', apiKey: '', source: 'environment' }
  if (needs.has('security')) {
    state.security = { enabled: false, recoveryLeft: 0, updatedAt: undefined, qr: undefined, secret: undefined, freshCodes: undefined }
  }
  return state
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-paging: ${problem}`)
  process.exit(1)
}

console.log(`check-paging: ${String(SECTIONS.length)} section(s), none of them unbounded`)
