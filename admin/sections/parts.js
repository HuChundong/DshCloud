/**
 * The pieces more than one section builds rows out of.
 *
 * Only what is genuinely shared. A row is part of its section — a tenant's row
 * belongs with the tenants and an invite's with the invites — so the rows
 * themselves live there, and what is here is the one control every section
 * ends up drawing: a button that posts one thing about one subject.
 *
 * @module sections/parts
 */

import { escapeHtml } from '../../gateway/src/page-chrome.js'

/** Distinguishes the forms on one page, so the dialog can submit the right one. */
let formSequence = 0

/**
 * One action button, as its own form.
 *
 * The confirmation rides on the form rather than in an inline handler, so the
 * page's one dialog can ask it and no markup carries executable script. It is
 * a KEY and its subjects, not a sentence: the dialog opens long after the page
 * was rendered, and by then the reader may have changed language.
 *
 * The button's Chinese is passed in rather than looked up. This module has no
 * string table on purpose — a shared table would have to carry every section's
 * words, and the gate that checks a page names everything it ships would then
 * see most of them as unused.
 *
 * @param {object} spec - the button.
 * @param {string} spec.path - where it posts.
 * @param {string} spec.subject - what it acts on: an address, or an invite code.
 * @param {string} spec.label - the string key for the button's text.
 * @param {string} spec.text - that text in Chinese, which is what the server writes.
 * @param {string} [spec.field] - the form field naming the subject.
 * @param {string} [spec.confirm] - the key of a question to ask first; omitted for reversible actions.
 * @param {string[]} [spec.args] - what fills that question's placeholders.
 * @returns {string} the form markup.
 */
export function action({ path, subject, label, text, field = 'email', confirm, args = [] }) {
  formSequence += 1
  const id = `f${String(formSequence)}`
  const guard = confirm === undefined
    ? ''
    : ` data-confirm="${confirm}" data-confirm-args="${escapeHtml(JSON.stringify(args))}"`
  return `<form method="post" action="${path}" id="${id}"${guard}>
        <input type="hidden" name="${field}" value="${escapeHtml(subject)}">
        <button type="submit"${confirm === undefined ? '' : ' class="danger"'} data-t="${label}">${escapeHtml(text)}</button>
      </form>`
}
