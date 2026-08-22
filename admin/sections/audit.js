/**
 * What was done here, and when.
 *
 * The console can rotate the credential every tenant's agent calls with,
 * suspend an account, erase one, and move anybody between tiers. None of that
 * left a trace: `settings` carries an `updated_by`, which says who touched a
 * row last and nothing about what it held before, or how many times.
 *
 * ## It answers "what", not "who"
 *
 * There is one operator credential, so the actor is always the same name. This
 * is a record of what changed and when, and it becomes a record of who the day
 * this console has more than one account. Saying so here is better than an
 * `actor` column that looks like it means something it cannot yet mean.
 *
 * ## Read-only, and that is structural
 *
 * Nothing on this page writes. The table is append-only by discipline —
 * nothing in the codebase updates or deletes a row — and a trail that can be
 * edited records only what somebody was willing to leave behind.
 *
 * @module sections/audit
 */

import { escapeHtml } from '../../gateway/src/page-chrome.js'
import { when } from '../console-shell.js'
import { PAGING_STRINGS, onePage, pager } from './paging.js'

export const icon = 'history'
export const label = { zh: '审计', en: 'Audit' }
export const lede = {
  zh: '这个控制台上发生过的每一次改动。只追加，不修改也不删除；这里没有任何按钮会写入。',
  en: 'Every change made from this console. Append-only — nothing updates or deletes a row, and nothing on this page writes one.',
}

/**
 * What each recorded action is called.
 *
 * Keyed by the same stable name the writer uses, so a row written by an older
 * build still renders: an action this table does not know is shown by its id
 * rather than as a blank.
 */
const ACTIONS = {
  'account.suspended': { zh: '停用账号', en: 'Account suspended' },
  'account.restored': { zh: '恢复账号', en: 'Account restored' },
  'account.erased': { zh: '删除账号', en: 'Account deleted' },
  'plan.moved': { zh: '更改套餐', en: 'Tier changed' },
  'invites.minted': { zh: '生成邀请码', en: 'Invite codes generated' },
  'invite.discarded': { zh: '删除邀请码', en: 'Invite code deleted' },
  'model.saved': { zh: '更新模型密钥', en: 'Model credential updated' },
  'access.saved': { zh: '更改接入设置', en: 'Access settings changed' },
  'tfa.enabled': { zh: '开启两步验证', en: 'Two-step verification turned on' },
  'tfa.disabled': { zh: '关闭两步验证', en: 'Two-step verification turned off' },
  'tfa.recovery': { zh: '重新生成备用码', en: 'Recovery codes replaced' },
}

export const strings = {
  ...PAGING_STRINGS,
  'th.at': { zh: '时间', en: 'When' },
  'th.action': { zh: '动作', en: 'Action' },
  'th.subject': { zh: '对象', en: 'Subject' },
  'th.detail': { zh: '详情', en: 'Detail' },
  'empty.audit': { zh: '还没有记录。', en: 'Nothing recorded yet.' },
  'audit.note': {
    zh: '这里记的是"改了什么"，不是"谁改的"——这套部署只有一个运营账号。密钥本身从不入库，连末四位也不记。',
    en: 'This records what changed rather than who changed it — the deployment has one operator credential. No credential is ever written here, not even its last four characters.',
  },
}

/**
 * One entry's row.
 *
 * @param {{at: Date, actor: string, action: string, subject: string|null, detail: object}} entry - the entry.
 * @returns {string} the row markup.
 */
function auditRow(entry) {
  const known = ACTIONS[entry.action] !== undefined
  const said = known
    ? `<span data-t="do.${entry.action}">${escapeHtml(ACTIONS[entry.action].zh)}</span>`
    : `<span class="code">${escapeHtml(entry.action)}</span>`

  // The detail as pairs rather than as JSON. It is written by the action that
  // happened and read by whoever is asking what happened, and a brace is
  // neither of their languages.
  const detail = Object.entries(entry.detail ?? {})
    .map(([key, value]) => `${escapeHtml(key)} ${escapeHtml(String(value))}`)
    .join(' · ')

  return `      <tr>
        <td class="sub">${when(entry.at.getTime())}</td>
        <td>${said}</td>
        <td class="sub">${entry.subject === null ? '' : escapeHtml(entry.subject)}</td>
        <td class="sub">${detail}</td>
      </tr>`
}

/**
 * Draw the section.
 *
 * @param {{audit: Array<{at: Date, actor: string, action: string, subject: string|null, detail: object}>}} state - what to show.
 * @returns {{html: string}} the markup.
 */
export function render(state) {
  const shown = onePage(state.audit)
  const rows = shown.length === 0
    ? '<tr><td colspan="4" class="empty" data-t="empty.audit">还没有记录。</td></tr>'
    : shown.map(auditRow).join('\n')

  // Only the names on this page. Shipping every action's wording on every
  // visit would send the browser a dictionary for rows it is not showing, and
  // the check that a page names everything it carries would be right to call
  // the rest of it dead.
  const table = Object.fromEntries(
    [...new Set(state.audit.map((entry) => entry.action))]
      .filter((name) => ACTIONS[name] !== undefined)
      .map((name) => [`do.${name}`, ACTIONS[name]]),
  )

  const steps = pager({ path: '/audit', page: state.page, total: state.total, shown: shown.length })

  return {
    table: { ...table, ...steps.table },
    html: `  <section class="card list">
    <div class="rows">
    <table>
      <thead>
        <tr>
          <th data-t="th.at">时间</th>
          <th data-t="th.action">动作</th>
          <th class="hide-narrow" data-t="th.subject">对象</th>
          <th class="hide-narrow" data-t="th.detail">详情</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
    </div>
${steps.html}
    <p class="note" data-t="audit.note">这里记的是"改了什么"，不是"谁改的"——这套部署只有一个运营账号。密钥本身从不入库，连末四位也不记。</p>
  </section>`,
  }
}
