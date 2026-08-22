/**
 * The codes that admit somebody, and what became of each.
 *
 * @module sections/invites
 */

import { escapeHtml } from '../../gateway/src/page-chrome.js'
import { when } from '../console-shell.js'
import { action } from './parts.js'
import { PAGING_STRINGS, onePage, pager } from './paging.js'

export const icon = 'ticket'
export const label = { zh: '邀请码', en: 'Invite codes' }
export const lede = {
  zh: '一码一人，用过即留痕。只有在"设置"里开了"注册需要邀请码"时，它们才真正拦人。',
  en: 'One code, one person, and a record of who used it. They only gate anything while Settings requires an invite to register.',
}

export const strings = {
  ...PAGING_STRINGS,
  'invites.count': { zh: '生成数量', en: 'How many' },
  'invites.mint': { zh: '生成', en: 'Generate' },
  'th.code': { zh: '邀请码', en: 'Code' },
  'th.minted': { zh: '生成于', en: 'Created' },
  'th.status': { zh: '状态', en: 'Status' },
  'tag.unused': { zh: '未使用', en: 'Unused' },
  'act.delete': { zh: '删除', en: 'Delete' },
  'empty.invites': { zh: '还没有邀请码。', en: 'No invite codes yet.' },
  'confirm.invite': {
    zh: '删除 {0} 吗？它是 {1} 注册来源的记录，删除后无法恢复。',
    en: 'Delete {0}? It is the record of how {1} came to register, and cannot be recovered.',
  },
}

/**
 * One invite's row.
 *
 * A redeemed invite is the record of how an account came to exist, so deleting
 * one erases that record rather than revoking anything — hence a confirmation
 * on that side and none on the other, where there is nothing to lose.
 *
 * @param {{code: string, createdAt: number, redeemedAt: number | undefined, redeemedBy: string | undefined}} invite - the invite.
 * @returns {string} the row markup.
 */
function inviteRow(invite) {
  const spent = invite.redeemedAt !== undefined
  const status = spent
    ? `<span class="sub">${escapeHtml(invite.redeemedBy ?? '')} · ${when(invite.redeemedAt)}</span>`
    : '<span class="tag live" data-t="tag.unused">未使用</span>'
  const actions = action(spent
    ? {
      path: '/invites/discard',
      subject: invite.code,
      label: 'act.delete',
      text: '删除',
      field: 'code',
      confirm: 'confirm.invite',
      args: [invite.code, invite.redeemedBy ?? ''],
    }
    : { path: '/invites/discard', subject: invite.code, label: 'act.delete', text: '删除', field: 'code' })
  return `      <tr>
        <td><span class="code${spent ? ' spent' : ''}">${escapeHtml(invite.code)}</span></td>
        <td class="hide-narrow sub">${when(invite.createdAt)}</td>
        <td>${status}</td>
        <td class="actions">${actions}</td>
      </tr>`
}

/**
 * Draw the section.
 *
 * @param {{invites: Array<{code: string, createdAt: number, redeemedAt: number | undefined, redeemedBy: string | undefined}>}} state - what to show.
 * @returns {{html: string}} the markup.
 */
export function render(state) {
  const shown = onePage(state.invites)
  const rows = shown.length === 0
    ? '<tr><td colspan="4" class="empty" data-t="empty.invites">还没有邀请码。</td></tr>'
    : shown.map(inviteRow).join('\n')

  const steps = pager({ path: '/invites', page: state.page, total: state.total, shown: shown.length })

  return {
    table: steps.table,
    html: `  <section class="card list">
    <form method="post" action="/invites" class="mint">
      <input type="number" name="count" value="5" min="1" max="200" data-ta="invites.count" aria-label="生成数量">
      <button type="submit" data-t="invites.mint">生成</button>
    </form>
    <div class="rows">
    <table>
      <thead>
        <tr>
          <th data-t="th.code">邀请码</th>
          <th class="hide-narrow" data-t="th.minted">生成于</th>
          <th data-t="th.status">状态</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
    </div>
${steps.html}
  </section>`,
  }
}
