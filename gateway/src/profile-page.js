/**
 * The profile page: a name, a picture, and the cropper that makes one.
 *
 * Inlined and server-rendered like the sign-in page it follows, and for the
 * same reason: an account being asked for the first time has no sandbox yet and
 * may be here because the frontend bundle did not load. It borrows that page's
 * chrome outright — same palette, same field, same button — because a person
 * meets the two one after the other and they are one product.
 *
 * The cropping is the only part that needs JavaScript, and it is the only part
 * that degrades: with scripting off the name still submits, the stored picture
 * still shows, and the file input simply does nothing. That is deliberate —
 * a page that cannot be submitted at all would be a locked door, because the
 * shell's gate will not let an unanswered account past.
 *
 * Everything happens on a canvas. The gateway holds the Docker socket and must
 * not grow an image decoder for tenant-supplied bytes, so the browser is what
 * resizes, crops, and encodes; what crosses the wire is already a 256×256 image
 * of a type this deployment allows.
 */

import { policyLinks } from './policy-page.js'
import {
  FONT_PRELOAD,
  GROUND_CSS,
  GROUND_HTML,
  GROUND_SCRIPT,
  PALETTE_CSS,
  THEME_TOGGLE,
  TOAST_CSS,
  escapeHtml,
  toast,
} from './page-chrome.js'

/** The cropping viewport, and the square that comes out of it. Both in CSS pixels. */
const VIEW_PX = 240
const OUTPUT_PX = 256

/**
 * Render the profile page.
 *
 * One page in two states, told apart by whether the account has ever answered
 * it. The difference is entirely wording and whether there is a way out: an
 * account being asked has nowhere to go but through, and one editing came from
 * the application and must be able to go back to it.
 *
 * @param {object} state - what to show.
 * @param {string} state.email - the caller's address, shown as the thing they cannot change.
 * @param {string} [state.name] - the stored name, or the rejected one being corrected.
 * @param {string} [state.avatar] - the stored avatar as a `data:` URI.
 * @param {boolean} [state.first] - whether this account has never answered, which makes it the way in rather than a settings page.
 * @param {string} [state.error] - what went wrong with the previous attempt.
 * @param {number} state.avatarLimit - the largest `data:` URI the server will store, which the encoder aims under.
 * @param {number} state.nameLimit - the longest name the server will store.
 * @param {string} [state.version] - the dsh release this deployment runs.
 * @returns {string} the HTML document.
 */
export function profilePage(state) {
  const { email, name, avatar, first, error, avatarLimit, nameLimit, version } = state

  // The letter behind an absent picture: the same fallback the sidebar shows,
  // so the preview here is honest about what the application will render.
  const fallback = [...(name ?? email)][0] ?? ''
  const release = version === undefined || version === '' ? '' : ` · v${escapeHtml(version)}`

  // Three things can be under the cropping viewport, and only one at a time:
  // the letter, the stored picture, or the canvas a new one is being cropped
  // on. Which is a `data-mode` on the stage, because the script switches
  // between them and CSS is a better place to say what each looks like.
  const mode = avatar === undefined ? 'letter' : 'stored'

  // Closing the account, and why it is not offered on the way in.
  //
  // An account being asked for a name for the first time has nothing to delete
  // yet and is one form away from the application; putting an irreversible
  // action beside the button that admits them would be the worst place this
  // page could put one. Someone who wants out before answering can simply never
  // come back — and can close the account from here once they have.
  //
  // A separate form posting to its own path, with the address typed out. The
  // dialog below asks first when there is JavaScript; this field is what the
  // server actually requires, so the page still works without it.
  const closing = first === true ? '' : `<section class="closing">
    <h2>注销账号</h2>
    <p>
      注销会立即删除你的账号、登录会话、沙箱和工作区文件。本部署不做备份，因此这个操作
      <b>无法撤销</b>，删除的内容也无法找回。详见 <a href="/policy/privacy" target="_blank" rel="noopener">《数据处理说明》</a>。
    </p>
    <form method="post" action="/profile/delete" id="close-form" data-confirm="真的要注销吗？账号、沙箱和工作区文件会被立即删除，且无法恢复。">
      <div class="field">
        <input name="confirm" aria-label="输入你的邮箱以确认" placeholder="输入 ${escapeHtml(email)} 以确认"
               autocomplete="off" spellcheck="false" required>
      </div>
      <button type="submit" class="danger">注销账号</button>
    </form>
  </section>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${first === true ? '完善资料' : '个人资料'} · DeepSeek Harness</title>
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg">
${FONT_PRELOAD}
<style>
${PALETTE_CSS}
${GROUND_CSS}
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    color: var(--fg);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    /* Clears the theme button in the corner, as on the sign-in page. */
    padding: 5rem 1.25rem 2rem;
  }

  .brand { display: flex; align-items: center; gap: .5rem; margin-bottom: 1.75rem; }
  .brand img { width: 28px; height: 28px; display: block; }
  .brand .word { font-family: var(--display); font-size: 1.5rem; font-weight: 600; letter-spacing: -.03em; color: var(--fg); }

  /* The sign-in page's card, holding the one column this page has: the two are
     met one after the other and a form that changed its ground between them
     would read as a different site. */
  /* The profile form by id, not every form on the page: the account-closing
     form below is a second one, and dressing it as a card too put a card
     inside a card. */
  #form {
    /* 336 of column plus the padding on either side of it: the fields, the
       cropping stage and the button are all sized against that column, and
       taking the card's padding out of it would narrow every one of them. */
    width: min(400px, 100%);
    padding: clamp(22px, 4vw, 32px);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-panel);
    background: var(--panel);
    box-shadow: var(--lift);
  }

  h1 { font-family: var(--display); margin: 0 0 .3rem; font-size: 1.25rem; font-weight: 600; letter-spacing: -.03em; text-align: center; }
  .lede { margin: 0 0 1.5rem; color: var(--muted); font-size: .8125rem; text-align: center; line-height: 1.55; }

  /* Round, because the application renders it round: a square preview would be
     a promise the sidebar does not keep. Overflow is what makes the circle out
     of a square canvas, and the ring keeps it off a same-coloured page. */
  .stage {
    position: relative;
    width: ${VIEW_PX}px;
    height: ${VIEW_PX}px;
    margin: 0 auto 1rem;
    border-radius: 50%;
    overflow: hidden;
    /* A well in the card rather than the card's own colour: --panel is what
       the card is made of now, and a circle painted in it would only be its
       hairline ring. */
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--line);
  }
  .stage canvas, .stage .stored { position: absolute; inset: 0; width: 100%; height: 100%; display: none; }
  .stage .stored { object-fit: cover; }
  .stage .letter {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: 5rem;
    font-weight: 500;
    text-transform: uppercase;
    user-select: none;
  }
  .stage[data-mode="stored"] .stored { display: block; }
  .stage[data-mode="stored"] .letter { display: none; }
  /* Grabbable only while there is something to drag. */
  .stage[data-mode="crop"] canvas { display: block; cursor: grab; touch-action: none; }
  .stage[data-mode="crop"]:active canvas { cursor: grabbing; }
  .stage[data-mode="crop"] .letter { display: none; }

  /* Hidden until there is an image to zoom, so the control never sits there
     doing nothing to a letter. */
  .zoom { display: none; width: ${VIEW_PX}px; margin: 0 auto 1rem; }
  .stage[data-mode="crop"] ~ .zoom { display: block; }
  .zoom input { width: 100%; accent-color: var(--ink); }

  .pick { display: flex; justify-content: center; gap: .75rem; margin-bottom: 1.75rem; }
  .pick button {
    width: auto;
    height: 2.25rem;
    padding: 0 1rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: .8125rem;
    font-weight: 500;
    cursor: pointer;
  }
  .pick button:hover { border-color: var(--muted); opacity: 1; }
  .pick button[data-danger] { color: var(--danger); }
  /* Nothing to remove until there is something there. */
  .stage[data-mode="letter"] ~ .pick button[data-danger] { display: none; }
  .pick input[type="file"] { display: none; }

  .field {
    display: flex;
    align-items: center;
    height: 3rem;
    padding: 0 1rem;
    margin-bottom: .625rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-field);
    background: var(--bg);
    transition: border-color .16s, box-shadow .16s;
  }
  .field:hover { border-color: var(--line-strong); }
  .field:focus-within { border-color: var(--line-strong); box-shadow: 0 0 0 4px var(--ring); }
  .field input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font: inherit;
    color: var(--fg);
  }
  .field input::placeholder { color: var(--faint); }
  /* Inset against the card, and told apart from the editable field above it by
     being the one thing on the form that is not --bg. */
  .field.readonly { background: var(--surface); border-color: var(--line-soft); }
  .field.readonly:hover { border-color: var(--line-soft); }
  .field.readonly input { color: var(--muted); background: transparent; cursor: default; }

  button[type="submit"] {
    width: 100%;
    height: 3rem;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--ink);
    color: var(--on-ink);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: background .16s;
  }
  button[type="submit"]:hover { background: var(--ink-hover); }

  .alt {
    display: flex;
    justify-content: center;
    margin-top: 1.25rem;
    color: var(--muted);
    font-size: .8125rem;
  }
  .alt a { color: var(--fg); text-decoration: none; border-bottom: 1px solid var(--line); padding-bottom: 1px; }

  .hint { margin: -.5rem 0 1rem; color: var(--danger); font-size: .8125rem; text-align: center; }
  .hint:empty { display: none; }

${TOAST_CSS}

  /* Outside the form's card and quieter than it: this is not a second thing to
     fill in on the way past, it is where you come back to when you want out.
     The one loud element is the button, and it is loud in the danger colour
     rather than in the ink one, so it cannot be mistaken for "save". */
  .closing {
    width: min(400px, 100%);
    margin-top: 1.25rem;
    padding: clamp(20px, 4vw, 28px);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-panel);
    background: var(--panel);
  }
  .closing h2 { font-family: var(--display); margin: 0 0 .4rem; font-size: .9375rem; font-weight: 600; letter-spacing: -.02em; }
  .closing p { margin: 0 0 1rem; color: var(--muted); font-size: .75rem; line-height: 1.7; }
  .closing b { color: var(--fg); font-weight: 500; }
  .closing a { color: var(--muted); text-decoration: none; border-bottom: 1px solid var(--line); }
  .closing a:hover { color: var(--fg); border-color: var(--line-strong); }
  .closing .field { margin-bottom: .625rem; }
  .closing .field input { font-size: .8125rem; }
  button.danger {
    width: 100%;
    height: 2.5rem;
    border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--line));
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--danger);
    font: inherit;
    font-size: .8125rem;
    cursor: pointer;
    transition: background .16s, border-color .16s;
  }
  button.danger:hover { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); }

  /* A native dialog rather than a hand-rolled overlay, as the console uses:
     the browser owns the focus trap, the escape key and the top layer. */
  dialog {
    max-width: min(90vw, 24rem);
    padding: 1.25rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-panel);
    background: var(--panel);
    color: var(--fg);
    box-shadow: var(--lift);
  }
  dialog::backdrop { background: rgb(0 0 0 / 35%); }
  dialog h3 { margin: 0 0 .5rem; font-size: 1rem; font-weight: 600; }
  dialog p { margin: 0 0 1.25rem; color: var(--muted); font-size: .8125rem; line-height: 1.6; }
  dialog .buttons { display: flex; justify-content: flex-end; gap: .5rem; }
  dialog button {
    padding: .45rem .9rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-pill);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: .8125rem;
    cursor: pointer;
  }
  dialog button.go { border-color: var(--danger); background: var(--danger); color: #fff; }

  footer {
    display: grid;
    justify-items: center;
    gap: .75rem;
    padding: 1.5rem 1.25rem 2.5rem;
    text-align: center;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--faint);
  }
  footer p { margin: 0; }
  .docs { display: flex; flex-wrap: wrap; justify-content: center; font-family: var(--sans); font-size: .75rem; }
  .docs a { color: var(--muted); text-decoration: none; }
  .docs a:hover { color: var(--fg); }
</style>
</head>
<body>
${toast(error, undefined)}
${THEME_TOGGLE}
${GROUND_HTML}
<div class="glow" aria-hidden="true"></div>
<main>
  <div class="brand">
    <img src="/login-assets/mark.svg" alt="">
    <span class="word">deepseek</span>
  </div>

  <form method="post" action="/profile" id="form">
    <h1>${first === true ? '先介绍一下你自己' : '个人资料'}</h1>
    <p class="lede">${first === true ? '昵称和头像会显示在侧边栏，之后随时可以改。' : '昵称和头像会显示在侧边栏。'}</p>

    <div class="stage" id="stage" data-mode="${mode}">
      <span class="letter">${escapeHtml(fallback)}</span>
      ${avatar === undefined ? '' : `<img class="stored" id="stored" src="${escapeHtml(avatar)}" alt="">`}
      <canvas id="canvas" width="${VIEW_PX}" height="${VIEW_PX}"></canvas>
    </div>

    <div class="zoom"><input type="range" id="zoom" min="1" max="4" step="0.01" value="1" aria-label="缩放"></div>

    <div class="pick">
      <button type="button" id="choose">选择图片</button>
      <button type="button" id="remove" data-danger="true">移除</button>
      <input type="file" id="file" accept="image/png,image/jpeg,image/webp,image/gif">
    </div>

    <p class="hint" id="hint"></p>

    <div class="field">
      <input name="name" id="name" aria-label="昵称" placeholder="昵称" value="${escapeHtml(name ?? '')}"
             maxlength="${nameLimit}" autocomplete="nickname" autofocus required>
    </div>
    <div class="field readonly">
      <input value="${escapeHtml(email)}" aria-label="邮箱" readonly tabindex="-1">
    </div>

    <input type="hidden" name="avatar" id="avatar" value="">
    <input type="hidden" name="avatar_clear" id="avatar_clear" value="">

    <button type="submit">${first === true ? '开始使用' : '保存'}</button>
    ${first === true ? '' : '<div class="alt"><a href="/">返回</a></div>'}
  </form>

  ${closing}
</main>
<footer>
  <nav class="docs">${policyLinks({ separator: '' })}</nav>
  <p>DeepSeek Harness · 自建部署${release}</p>
</footer>
<script>
  (function () {
    var VIEW = ${VIEW_PX}
    var OUT = ${OUTPUT_PX}
    var LIMIT = ${avatarLimit}

    var stage = document.getElementById('stage')
    var canvas = document.getElementById('canvas')
    var ctx = canvas.getContext('2d')
    var zoom = document.getElementById('zoom')
    var file = document.getElementById('file')
    var hint = document.getElementById('hint')
    var avatarField = document.getElementById('avatar')
    var clearField = document.getElementById('avatar_clear')
    var hadStored = stage.dataset.mode === 'stored'

    // The image being cropped, the scale at which it exactly covers the
    // viewport, the scale in force, and where its top-left corner sits.
    var img = null
    var cover = 1
    var scale = 1
    var x = 0
    var y = 0

    /**
     * Keep the image covering the viewport.
     *
     * Clamped rather than centred, so a drag stops at the edge instead of
     * springing back — and so no crop can include a corner that has no image
     * in it, which would come out as a transparent wedge.
     */
    function clamp() {
      var w = img.width * scale
      var h = img.height * scale
      x = Math.min(0, Math.max(VIEW - w, x))
      y = Math.min(0, Math.max(VIEW - h, y))
    }

    function draw() {
      ctx.clearRect(0, 0, VIEW, VIEW)
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale)
    }

    function fit() {
      cover = Math.max(VIEW / img.width, VIEW / img.height)
      scale = cover
      x = (VIEW - img.width * scale) / 2
      y = (VIEW - img.height * scale) / 2
      zoom.value = '1'
      draw()
    }

    document.getElementById('choose').addEventListener('click', function () { file.click() })

    document.getElementById('remove').addEventListener('click', function () {
      img = null
      file.value = ''
      hint.textContent = ''
      avatarField.value = ''
      // Only meaningful against something already stored. Backing out of a
      // picture that was merely chosen is a return to the letter, not an
      // instruction to the server.
      clearField.value = hadStored ? '1' : ''
      stage.dataset.mode = 'letter'
    })

    file.addEventListener('change', function () {
      var chosen = file.files && file.files[0]
      if (!chosen) return
      var url = URL.createObjectURL(chosen)
      var loaded = new Image()
      loaded.onload = function () {
        URL.revokeObjectURL(url)
        img = loaded
        hint.textContent = ''
        // A new picture supersedes whatever was stored, so a removal asked for
        // earlier in this visit is no longer what the person means.
        clearField.value = ''
        stage.dataset.mode = 'crop'
        fit()
      }
      loaded.onerror = function () {
        URL.revokeObjectURL(url)
        hint.textContent = '这个文件无法作为图片打开，请换一张。'
      }
      loaded.src = url
    })

    zoom.addEventListener('input', function () {
      if (!img) return
      var next = cover * Number(zoom.value)
      // Zoom about the middle of the viewport, which is the part being looked
      // at. Scaling about the origin instead walks the subject off the frame.
      var centre = VIEW / 2
      x = centre - (centre - x) / scale * next
      y = centre - (centre - y) / scale * next
      scale = next
      clamp()
      draw()
    })

    var dragging = false
    var lastX = 0
    var lastY = 0
    canvas.addEventListener('pointerdown', function (event) {
      if (!img) return
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      canvas.setPointerCapture(event.pointerId)
    })
    canvas.addEventListener('pointermove', function (event) {
      if (!dragging) return
      x += event.clientX - lastX
      y += event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      clamp()
      draw()
    })
    var release = function (event) {
      if (!dragging) return
      dragging = false
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)

    /**
     * Encode the crop, small enough for the server to keep.
     *
     * WebP where it exists and JPEG where it does not — a canvas asked for a
     * type it cannot make answers in PNG without saying so, and a PNG
     * photograph is several times the size of either. Quality steps down until
     * the result fits, so an unusually busy image loses detail rather than
     * being refused.
     */
    function encode(out) {
      var qualities = [0.85, 0.7, 0.55, 0.4]
      for (var i = 0; i < qualities.length; i++) {
        var url = out.toDataURL('image/webp', qualities[i])
        if (url.indexOf('data:image/webp') !== 0) url = out.toDataURL('image/jpeg', qualities[i])
        if (url.length <= LIMIT) return url
      }
      return null
    }

    document.getElementById('form').addEventListener('submit', function (event) {
      if (!img) return
      var out = document.createElement('canvas')
      out.width = OUT
      out.height = OUT
      var octx = out.getContext('2d')
      octx.imageSmoothingQuality = 'high'
      // The same crop the preview shows, at the output's scale: one factor
      // applied to every term, so what is submitted is what was looked at.
      var k = OUT / VIEW
      octx.drawImage(img, x * k, y * k, img.width * scale * k, img.height * scale * k)
      var encoded = encode(out)
      if (encoded === null) {
        event.preventDefault()
        hint.textContent = '这张图片压不到限制以内，请换一张。'
        return
      }
      avatarField.value = encoded
    })
  })()
</script>

<dialog id="confirm">
  <h3>注销账号</h3>
  <p id="confirm-text"></p>
  <div class="buttons">
    <button type="button" value="cancel">取消</button>
    <button type="button" class="go" value="go">确认注销</button>
  </div>
</dialog>
<script>
  // Progressive, like the console's: with scripting on, the irreversible form
  // asks once more before it posts; with it off, the typed address is the
  // confirmation and the server is the one enforcing it either way.
  (function () {
    var form = document.getElementById('close-form')
    var dialog = document.getElementById('confirm')
    if (!form || !dialog) return
    var text = document.getElementById('confirm-text')

    form.addEventListener('submit', function (event) {
      if (form.dataset.confirmed === '1') return
      event.preventDefault()
      // The browser's own validation first: asking someone to confirm a
      // deletion and then telling them the field was empty is two dialogs for
      // one mistake.
      if (!form.reportValidity()) return
      text.textContent = form.dataset.confirm
      dialog.showModal()
    })

    dialog.addEventListener('click', function (event) {
      var value = event.target.value
      if (value === undefined) return
      dialog.close()
      if (value !== 'go') return
      // Submitting in script does not fire the event above, and the flag is
      // there in case a browser ever decides it should.
      form.dataset.confirmed = '1'
      form.submit()
    })
  })()
</script>
${GROUND_SCRIPT}
</body>
</html>
`
}
