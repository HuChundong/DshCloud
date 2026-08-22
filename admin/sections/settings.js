/**
 * What the deployment does, rather than who is on it.
 *
 * Two switches that are genuinely one decision each — who may come in, and
 * what a sandbox calls the model with — and both are read by the gateway
 * rather than by this service. A row here wins over the environment; with no
 * row, the console shows what the environment says, which is why this service
 * is given the same variables the gateway is.
 *
 * @module sections/settings
 */

import { escapeHtml } from '../../gateway/src/page-chrome.js'
import { describeKey } from '../../gateway/src/settings.js'
import { when } from '../console-shell.js'

export const icon = 'settings'
export const label = { zh: '设置', en: 'Settings' }
export const lede = {
  zh: '注册门槛、沙箱上限，以及每个租户的 agent 调用所用的模型密钥。',
  en: 'Who may register, how many sandboxes may run, and the credential every tenant’s agent calls with.',
}

export const strings = {
  save: { zh: '保存', en: 'Save' },
  env: { zh: '环境变量', en: 'environment' },

  'access.h': { zh: '接入', en: 'Access' },
  'access.invite': { zh: '注册需要邀请码', en: 'Registration needs an invite code' },
  'access.limit': { zh: '沙箱上限', en: 'Sandbox ceiling' },
  'access.note.capped': {
    zh: '沙箱上限 {0}。达到上限后，手上没有沙箱的账号既不能注册也不能登录，已在运行的租户不受影响。当前在线数由平台侧统计，这里不显示。',
    en: 'Sandbox ceiling: {0}. Once it is reached, an account without a sandbox can neither register nor sign in; tenants already running are unaffected. How many are running is counted where machines are managed, not here.',
  },
  'access.note.uncapped': {
    zh: '沙箱数量不限。填一个大于 0 的数即可设上限；当前在线数由平台侧统计，这里不显示。',
    en: 'No sandbox ceiling. Enter a number above 0 to set one. How many are running is counted where machines are managed, not here.',
  },

  'model.h': { zh: '模型密钥', en: 'Model credential' },
  'model.url': { zh: '接口地址', en: 'Endpoint' },
  'model.key': { zh: '新密钥（留空则不改动）', en: 'New key (leave empty to keep the current one)' },

  // `describeKey` renders these; the credential itself is never shown back.
  'key.unset': { zh: '未设置', en: 'not set' },
  'key.set': { zh: '已设置', en: 'set' },
  'key.tail': { zh: '末四位', en: 'last four' },
}

/**
 * Where a setting came from, said beside it.
 *
 * An operator reading a switch needs to know whether the console owns it or
 * the compose file does, because that decides where a change has to be made.
 *
 * @param {{source: string, updatedAt: number|undefined, updatedBy: string|undefined}} setting - the setting.
 * @returns {string} the hint markup.
 */
function origin(setting) {
  return setting.source === 'console'
    ? `${escapeHtml(setting.updatedBy ?? '')} · ${when(setting.updatedAt)}`
    : '<span data-t="env">环境变量</span>'
}

/**
 * Draw the section.
 *
 * @param {object} state - what to show.
 * @param {{inviteRequired: boolean, sandboxLimit: number, source: string, updatedAt: number|undefined, updatedBy: string|undefined}} state.access - the gate in force.
 * @param {{baseUrl: string, apiKey: string, source: string, updatedAt: number|undefined, updatedBy: string|undefined}} state.credential - the model credential, described rather than shown.
 * @returns {{html: string, table: object}} the markup, and the one sentence composed at render time.
 */
export function render(state) {
  const { access, credential } = state

  // Two sentences rather than one with a hole in it. With a hole, the no-limit
  // case read "ceiling: no limit — enter 0 for no limit", which is the
  // sentence explaining itself back to the reader.
  const ceiling = access.sandboxLimit === 0 ? undefined : String(access.sandboxLimit)
  const noteKey = ceiling === undefined ? 'access.note.uncapped' : 'access.note.capped'
  const note = ceiling === undefined
    ? strings[noteKey]
    : {
      zh: strings[noteKey].zh.replace('{0}', ceiling),
      en: strings[noteKey].en.replace('{0}', ceiling),
    }

  return {
    table: { [noteKey]: note },
    html: `  <section class="card">
    <h2><span data-t="access.h">接入</span> <span class="hint">${origin(access)}</span></h2>
    <form method="post" action="/access" class="creds">
      <label class="check">
        <input type="checkbox" name="inviteRequired" value="on"${access.inviteRequired ? ' checked' : ''}>
        <span data-t="access.invite">注册需要邀请码</span>
      </label>
      <label class="check">
        <span data-t="access.limit">沙箱上限</span>
        <input type="number" name="sandboxLimit" min="0" max="10000" step="1" value="${access.sandboxLimit}" data-ta="access.limit" aria-label="沙箱上限">
      </label>
      <button type="submit" class="save" data-t="save">保存</button>
    </form>
    <p class="note" data-t="${noteKey}">${escapeHtml(note.zh)}</p>
  </section>

  <section class="card">
    <h2><span data-t="model.h">模型密钥</span> <span class="hint">${describeKey(credential.apiKey)} · ${origin(credential)}</span></h2>
    <form method="post" action="/model" class="creds">
      <input name="baseUrl" value="${escapeHtml(credential.baseUrl)}" data-tp="model.url" placeholder="接口地址" aria-label="接口地址" autocomplete="off" spellcheck="false">
      <input name="apiKey" type="password" data-tp="model.key" placeholder="新密钥（留空则不改动）" aria-label="新密钥" autocomplete="new-password">
      <button type="submit" class="save" data-t="save">保存</button>
    </form>
  </section>`,
  }
}
