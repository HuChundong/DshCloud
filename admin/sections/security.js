/**
 * The second factor in front of this console.
 *
 * Enrolled here and nowhere else. A secret that can only be written to a file
 * cannot be the place a phone is enrolled, so there is no environment variable
 * for it any more — sign in, press the button, scan the square, and type one
 * code to prove the square was read.
 *
 * That last step is the important one. Enable first and verify later, and a QR
 * photographed at an angle or a phone with a wrong clock locks the only
 * operator out of the only console, with the right password and no way in.
 *
 * @module sections/security
 */

import { escapeHtml } from '../../gateway/src/page-chrome.js'
import { when } from '../console-shell.js'

export const icon = 'shield'
export const label = { zh: '安全', en: 'Security' }
export const lede = {
  zh: '这个控制台能改动每一个账号，而它在公网上。第二因素是密码泄露之后仍然挡在前面的那道门。',
  en: 'This console can change every account, and it is on the public internet. The second factor is what still stands there once the password is known.',
}

export const strings = {
  'tfa.h': { zh: '两步验证', en: 'Two-step verification' },
  'tfa.on': { zh: '已开启', en: 'on' },
  'tfa.off': { zh: '未开启', en: 'off' },
  'tfa.off.note': {
    zh: '现在只有一个密码挡在这个控制台前面，而这个控制台能改动每一个账户。开启后，登录还需要验证器 App 上的 6 位数字。',
    en: 'One password is all that stands in front of this console, and this console can change every account. With this on, signing in also takes the six digits from an authenticator app.',
  },
  'tfa.on.note': {
    zh: '登录时会要求输入验证器上的 6 位数字。剩余备用码：{0}。',
    en: 'Signing in asks for the six digits from your authenticator. Recovery codes left: {0}.',
  },
  'tfa.begin': { zh: '开启两步验证', en: 'Turn on two-step verification' },
  'tfa.password': { zh: '当前密码', en: 'Current password' },
  'tfa.scan': {
    zh: '用验证器 App 扫描下面的二维码，然后输入它显示的 6 位数字。验证通过后才会真正开启。',
    en: 'Scan this with an authenticator app, then type the six digits it shows. Nothing is turned on until those digits check out.',
  },
  'tfa.manual': { zh: '扫不上可以手动输入：', en: 'Or type the secret in by hand:' },
  'tfa.code': { zh: '6 位验证码', en: 'Six-digit code' },
  'tfa.verify': { zh: '验证并开启', en: 'Verify and turn on' },
  'tfa.cancel': { zh: '取消', en: 'Cancel' },
  'tfa.remint': { zh: '重新生成备用码', en: 'Replace recovery codes' },
  'tfa.disable': { zh: '关闭两步验证', en: 'Turn two-step verification off' },
  'tfa.confirm': {
    zh: '关闭后，只要有密码就能进入这个控制台。确定关闭？',
    en: 'With this off, the password alone opens this console. Turn it off?',
  },
  'tfa.codes.note': {
    zh: '备用码。每个只能用一次，用于手机丢失时登录。现在保存好——离开这个页面后无法再看到。',
    en: 'Recovery codes. Each works once, for signing in when the phone is not to hand. Save them now — they are stored hashed and this page is the only place they are readable.',
  },
  'tfa.codes.done': { zh: '我已保存', en: 'Saved them' },
}

/**
 * Draw the section.
 *
 * @param {object} state - what to show.
 * @param {{enabled: boolean, recoveryLeft: number, updatedAt: number|undefined, qr: string|undefined, secret: string|undefined, freshCodes: string[]|undefined}} state.security - the enrolment, and any half-finished one.
 * @returns {{html: string, table: object}} the markup, and the one sentence composed at render time.
 */
export function render(state) {
  const factor = state.security

  const left = String(factor.recoveryLeft)
  const onNote = {
    zh: strings['tfa.on.note'].zh.replace('{0}', left),
    en: strings['tfa.on.note'].en.replace('{0}', left),
  }

  const hint = factor.enabled
    ? `<span data-t="tfa.on">已开启</span>${factor.updatedAt === undefined ? '' : ` · ${when(factor.updatedAt)}`}`
    : '<span data-t="tfa.off">未开启</span>'

  // Enrolling is a state of this card and not a separate page: the square
  // being scanned and the field that proves it was scanned belong beside each
  // other, and a page that navigated between them would be a page you can be
  // halfway through when the enrolment times out.
  const body = factor.freshCodes !== undefined
    // Shown once, and this is the once. They are stored as digests, so this
    // page is the only place they will ever exist in a readable form.
    ? `<p class="note" data-t="tfa.codes.note">备用码。每个只能用一次，用于手机丢失时登录。现在保存好——离开这个页面后无法再看到。</p>
    <ol class="codes">${factor.freshCodes.map((code) => `<li>${escapeHtml(code)}</li>`).join('')}</ol>
    <form method="post" action="/security/dismiss" id="tfa-done"><button type="submit" class="save" data-t="tfa.codes.done">我已保存</button></form>`
    : factor.qr !== undefined
      ? `<p class="note" data-t="tfa.scan">用验证器 App 扫描下面的二维码，然后输入它显示的 6 位数字。验证通过后才会真正开启。</p>
      <div class="qr">${factor.qr}</div>
      <p class="secret" data-t="tfa.manual">扫不上可以手动输入：</p>
      <p class="secret-value">${escapeHtml(factor.secret ?? '')}</p>
      <form method="post" action="/security/activate" id="tfa-activate" class="creds">
        <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code" data-tp="tfa.code" placeholder="6 位验证码" aria-label="6 位验证码">
        <button type="submit" class="save" data-t="tfa.verify">验证并开启</button>
      </form>
      <form method="post" action="/security/cancel" id="tfa-cancel"><button type="submit" class="quiet" data-t="tfa.cancel">取消</button></form>`
      : factor.enabled
        ? `<p class="note" data-t="tfa.on.note">${escapeHtml(onNote.zh)}</p>
          <form method="post" action="/security/recovery" id="tfa-recovery" class="creds">
            <input name="password" type="password" required autocomplete="current-password" data-tp="tfa.password" placeholder="当前密码" aria-label="当前密码">
            <button type="submit" class="save" data-t="tfa.remint">重新生成备用码</button>
          </form>
          <form method="post" action="/security/disable" id="tfa-disable" class="creds" data-confirm="tfa.confirm">
            <input name="password" type="password" required autocomplete="current-password" data-tp="tfa.password" placeholder="当前密码" aria-label="当前密码">
            <button type="submit" class="danger" data-t="tfa.disable">关闭两步验证</button>
          </form>`
        : `<p class="note" data-t="tfa.off.note">现在只有一个密码挡在这个控制台前面，而这个控制台能改动每一个账户。开启后，登录还需要验证器 App 上的 6 位数字。</p>
        <form method="post" action="/security/begin" id="tfa-begin" class="creds">
          <input name="password" type="password" required autocomplete="current-password" data-tp="tfa.password" placeholder="当前密码" aria-label="当前密码">
          <button type="submit" class="save" data-t="tfa.begin">开启两步验证</button>
        </form>`

  return {
    table: { 'tfa.on.note': onNote },
    html: `  <section class="card">
    <h2><span data-t="tfa.h">两步验证</span> <span class="hint">${hint}</span></h2>
${body}
  </section>`,
  }
}
