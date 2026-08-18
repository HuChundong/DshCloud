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

import { PALETTE_CSS, THEME_TOGGLE, TOAST_CSS, escapeHtml, toast } from './page-chrome.js'

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

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${first === true ? '完善资料' : '个人资料'} · DeepSeek Harness</title>
<link rel="icon" href="/favicon.svg">
<style>
${PALETTE_CSS}
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "PingFang SC",
          "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem 1.25rem;
  }

  .brand { display: flex; align-items: center; gap: .5rem; margin-bottom: 2rem; }
  .brand img { width: 34px; height: 34px; display: block; }
  .brand .word { font-size: 1.75rem; font-weight: 600; letter-spacing: -.02em; color: var(--ink); }

  form { width: 336px; }

  h1 { margin: 0 0 .35rem; font-size: 1.0625rem; font-weight: 600; text-align: center; }
  .lede { margin: 0 0 1.75rem; color: var(--muted); font-size: .8125rem; text-align: center; }

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
    background: var(--panel);
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
    padding: 0 1.25rem;
    margin-bottom: 1rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg);
    transition: border-color .15s, box-shadow .15s;
  }
  .field:focus-within { border-color: var(--ink); box-shadow: 0 0 0 3px var(--ring); }
  .field input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font: inherit;
    color: var(--fg);
  }
  .field input::placeholder { color: var(--muted); }
  .field.readonly input { color: var(--muted); background: var(--panel); cursor: default; }
  ::selection { background: rgb(10 10 10 / 14%); color: var(--fg); }

  button[type="submit"] {
    width: 100%;
    height: 3rem;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--on-ink);
    font: inherit;
    font-weight: 550;
    cursor: pointer;
    transition: opacity .15s;
  }
  button[type="submit"]:hover { opacity: .85; }

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

  footer { padding: 1.5rem; text-align: center; color: var(--muted); font-size: .8125rem; }
</style>
</head>
<body>
${toast(error, undefined)}
${THEME_TOGGLE}
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
</main>
<footer>DeepSeek Harness · 自建部署${release}</footer>
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
</body>
</html>
`
}
