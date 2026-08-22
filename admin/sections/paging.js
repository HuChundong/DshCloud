/**
 * A page of a list, and the control that moves between pages.
 *
 * The rule this exists to enforce: **a list section never renders an unbounded
 * list.** Not "usually", and not "once it gets long" — every one of them pages,
 * from the first row.
 *
 * The reason is not tidiness. An unbounded table is a page whose height is
 * decided by the deployment's success: it renders fine on the machine it was
 * built on, and the day a tenant list reaches four figures it is a document
 * that takes a second to lay out, a scrollbar that measures the table instead
 * of the page, and a query that read every row to show the twenty somebody was
 * looking at. All three arrive together, on the deployment least able to
 * absorb them.
 *
 * `check-pages` renders every section with more rows than a page holds and
 * fails if more than a page comes back, so this cannot be forgotten in the
 * next section rather than remembered in these.
 *
 * @module sections/paging
 */

import { escapeHtml } from '../../gateway/src/page-chrome.js'

/**
 * How many rows a page holds.
 *
 * Twenty is a query's worth, not a screenful: at the row height this console
 * uses, a page of twenty is about 1200px of table and the pane it lands in is
 * rarely that tall. The rows scroll inside their card for that reason, with
 * the pager pinned under them — so the number is chosen for how much is worth
 * fetching and rendering at once, and the layout is what makes it readable.
 *
 * The first version of this comment claimed twenty fitted above the fold. It
 * was written without measuring, and it did not: the pager sat 700px below it.
 */
export const PAGE_SIZE = 20

/** What the control says, in both languages the console speaks. */
export const PAGING_STRINGS = {
  'page.prev': { zh: '上一页', en: 'Previous' },
  'page.next': { zh: '下一页', en: 'Next' },
  'page.range': { zh: '第 {0}–{1} 条，共 {2} 条', en: '{0}–{1} of {2}' },
}

/**
 * Which page was asked for.
 *
 * One-based, because it is in a URL that a person reads. Anything that is not
 * a page is page one: a hand-edited query should land somewhere rather than
 * fail, and page one is where it would have started.
 *
 * @param {string | null | undefined} asked - the query parameter.
 * @returns {number} the page, at least 1.
 */
export function pageFrom(asked) {
  const wanted = Number.parseInt(String(asked ?? ''), 10)
  return Number.isInteger(wanted) && wanted > 0 ? wanted : 1
}

/**
 * The window of rows one page covers.
 *
 * @param {number} page - the page, one-based.
 * @returns {{limit: number, offset: number}} what to ask the store for.
 */
export function windowFor(page) {
  return { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }
}

/**
 * At most one page of what was handed over.
 *
 * The paging itself happens in SQL — this is the backstop, and it is here
 * because the failure it catches is silent. A store that stopped taking a
 * window, or a section that forgot to pass one, would still render: the page
 * would simply be a thousand rows long, laid out in a second and scrolled by
 * nobody, and the only symptom would be a console that felt slow on the
 * deployment with the most in it.
 *
 * `check-paging` hands every section twice a page and requires one back, which
 * is this function being asked to prove it is called.
 *
 * @param {Array<T>} rows - what the store returned.
 * @returns {Array<T>} at most `PAGE_SIZE` of them.
 * @template T
 */
export function onePage(rows) {
  return rows.length > PAGE_SIZE ? rows.slice(0, PAGE_SIZE) : rows
}

/**
 * The control, and the sentence that says where you are.
 *
 * Rendered even on the only page, where both buttons are disabled: the count
 * is the useful half, and a control that appears once a list gets long is a
 * control that moves the rows under the pointer the first time it does.
 *
 * @param {object} spec - what to draw.
 * @param {string} spec.path - the section's route, which the links stay on.
 * @param {number} spec.page - the page being shown, one-based.
 * @param {number} spec.total - how many rows there are in all.
 * @param {number} spec.shown - how many are on this page.
 * @returns {{html: string, table: object}} the markup, and the sentence it words.
 */
export function pager({ path, page, total, shown }) {
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const last = (page - 1) * PAGE_SIZE + shown
  const said = {
    zh: PAGING_STRINGS['page.range'].zh
      .replace('{0}', String(first)).replace('{1}', String(last)).replace('{2}', String(total)),
    en: PAGING_STRINGS['page.range'].en
      .replace('{0}', String(first)).replace('{1}', String(last)).replace('{2}', String(total)),
  }

  const back = page > 1
    ? `<a class="step" href="${path}?page=${String(page - 1)}" data-t="page.prev">上一页</a>`
    : '<span class="step off" data-t="page.prev">上一页</span>'
  const forward = last < total
    ? `<a class="step" href="${path}?page=${String(page + 1)}" data-t="page.next">下一页</a>`
    : '<span class="step off" data-t="page.next">下一页</span>'

  return {
    table: { 'page.range': said },
    html: `    <nav class="pager">
      <span class="range" data-t="page.range">${escapeHtml(said.zh)}</span>
      <span class="steps">${back}${forward}</span>
    </nav>`,
  }
}
