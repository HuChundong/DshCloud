/**
 * Who has an account, and what may be done about it.
 *
 * Two tables, because they are two kinds of row. An administrator is named by
 * the deployment's own configuration and cannot be un-named from here; a
 * tenant is whoever signed up. One table invited reading a suspend button
 * beside an account that has none.
 *
 * @module sections/tenants
 */

import { escapeHtml } from '../../gateway/src/page-chrome.js'
import { PLANS } from '../../gateway/src/plans.js'
import { when } from '../console-shell.js'
import { action } from './parts.js'
import { PAGING_STRINGS, onePage, pager } from './paging.js'

export const icon = 'people'
export const label = { zh: '租户', en: 'Tenants' }
export const lede = {
  zh: '这套部署上的每一个账号。停用会立刻吊销会话，删除会连同沙箱与数据卷一起带走。',
  en: 'Every account on this deployment. Suspending revokes sessions at once; deleting takes the sandbox and the volume with it.',
}

export const strings = {
  ...PAGING_STRINGS,
  'admins.h': { zh: '管理员', en: 'Administrators' },
  'users.h': { zh: '用户', en: 'Tenants' },
  save: { zh: '保存', en: 'Save' },

  'th.email': { zh: '邮箱', en: 'Email' },
  'th.created': { zh: '注册于', en: 'Registered' },
  'th.seen': { zh: '最近登录', en: 'Last seen' },
  'th.plan': { zh: '套餐', en: 'Plan' },

  // The tiers, worded. `plans.js` holds the ids and refuses to hold these: a
  // name has a language, and which language this page is in is a choice its
  // reader makes in the browser.
  'plan.free': { zh: '免费', en: 'Free' },
  'plan.pro': { zh: '专业', en: 'Pro' },
  'plan.team': { zh: '团队', en: 'Team' },

  'tag.off': { zh: '已停用', en: 'Disabled' },
  'act.delete': { zh: '删除', en: 'Delete' },
  'act.enable': { zh: '恢复', en: 'Enable' },
  'act.disable': { zh: '停用', en: 'Disable' },

  seen: { zh: '最近登录', en: 'Last seen' },

  'empty.admins': { zh: 'GATEWAY_ADMINS 里的地址还没有登录过。', en: 'No address in GATEWAY_ADMINS has signed in yet.' },
  'empty.tenants': { zh: '还没有人注册。', en: 'Nobody has registered yet.' },

  'confirm.account': {
    zh: '删除 {0} 吗？其会话、工作区与沙箱都会一并消失，且无法恢复。',
    en: 'Delete {0}? Their sessions, workspace and sandbox go with the account, and cannot be recovered.',
  },
}

/**
 * The control that moves one tenant between tiers.
 *
 * A select rather than a button per tier: three tiers beside the two actions
 * already there would be five things to aim at in one row, and the list is
 * meant to grow. The current tier is the selected option rather than a
 * separate label — the control states the fact and changes it, which is one
 * thing to read instead of two that can disagree.
 *
 * The submit button is real markup and not decoration: without scripting it is
 * the only way to send the change, and the page's script hides it and submits
 * on change instead.
 *
 * @param {import('../../gateway/src/accounts.js').Account} account - the tenant.
 * @returns {string} the form markup.
 */
function planPicker(account) {
  const options = PLANS.map((plan) => {
    const chosen = plan === account.plan ? ' selected' : ''
    return `<option value="${plan}"${chosen} data-t="plan.${plan}">${escapeHtml(strings[`plan.${plan}`].zh)}</option>`
  }).join('')
  return `<form method="post" action="/plan" class="plan">
        <input type="hidden" name="email" value="${escapeHtml(account.email)}">
        <select name="plan" data-ta="th.plan" aria-label="套餐">${options}</select>
        <button type="submit" data-t="save">保存</button>
      </form>`
}

/**
 * One administrator's row.
 *
 * No suspend and no delete. Suspending an administrator would leave them able
 * to sign in again — their admission comes from the environment, which this
 * page cannot edit — and deleting the account only makes them register it once
 * more. Offering either would be offering an action that does not do what it
 * says.
 *
 * @param {import('../../gateway/src/accounts.js').Account} account - the account.
 * @returns {string} the row markup.
 */
function adminRow(account) {
  return `      <tr>
        <td><div class="email">${escapeHtml(account.email)}</div></td>
        <td class="hide-narrow sub"><span data-t="seen">最近登录</span> ${when(account.lastSeenAt)}</td>
        <td class="actions"><span class="tag admin" data-t="plan.${account.plan}">${escapeHtml(strings[`plan.${account.plan}`].zh)}</span></td>
      </tr>`
}

/**
 * One tenant's row.
 *
 * No guard for the reader's own row, and none needed: this renders the
 * accounts that are NOT administrators, and the only principal reading this
 * page is not a tenant at all.
 *
 * @param {import('../../gateway/src/accounts.js').Account} account - the account.
 * @returns {string} the row markup.
 */
function tenantRow(account) {
  const tags = account.disabled ? '<span class="tag off" data-t="tag.off">已停用</span>' : ''
  const actions = `${action({
    path: '/toggle',
    subject: account.email,
    label: account.disabled ? 'act.enable' : 'act.disable',
    text: account.disabled ? '恢复' : '停用',
  })}
      ${action({
    path: '/delete',
    subject: account.email,
    label: 'act.delete',
    text: '删除',
    confirm: 'confirm.account',
    args: [account.email],
  })}`

  return `      <tr>
        <td><div class="email">${escapeHtml(account.email)}</div>${tags === '' ? '' : `<div>${tags}</div>`}</td>
        <td class="hide-narrow sub">${when(account.createdAt)}</td>
        <td class="hide-narrow sub">${when(account.lastSeenAt)}</td>
        <td>${planPicker(account)}</td>
        <td class="actions">${actions}</td>
      </tr>`
}

/**
 * Draw the section.
 *
 * @param {object} state - what to show.
 * @param {Array<import('../../gateway/src/accounts.js').Account>} state.admins - the addresses the deployment names.
 * @param {Array<import('../../gateway/src/accounts.js').Account>} state.tenants - one page of everybody else.
 * @param {number} state.page - which page that is.
 * @param {number} state.total - how many tenants there are in all.
 * @returns {{html: string}} the markup.
 */
export function render(state) {
  const adminRows = state.admins.length === 0
    ? '<tr><td colspan="3" class="empty" data-t="empty.admins">GATEWAY_ADMINS 里的地址还没有登录过。</td></tr>'
    : state.admins.map((account) => adminRow(account)).join('\n')
  const shown = onePage(state.tenants)
  const rows = shown.length === 0
    ? '<tr><td colspan="5" class="empty" data-t="empty.tenants">还没有人注册。</td></tr>'
    : shown.map((account) => tenantRow(account)).join('\n')

  const steps = pager({ path: '/', page: state.page, total: state.total, shown: shown.length })

  return {
    table: steps.table,
    html: `  <section class="card list">
    <h2 data-t="users.h">用户</h2>
    <div class="rows">
    <table>
      <thead>
        <tr>
          <th data-t="th.email">邮箱</th>
          <th class="hide-narrow" data-t="th.created">注册于</th>
          <th class="hide-narrow" data-t="th.seen">最近登录</th>
          <th data-t="th.plan">套餐</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
    </div>
${steps.html}
  </section>

  <section class="card">
    <h2 data-t="admins.h">管理员</h2>
    <table><tbody>
${adminRows}
    </tbody></table>
  </section>`,
  }
}
