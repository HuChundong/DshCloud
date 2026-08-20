/*
  Both languages, one line per string. A key present on one side and missing on
  the other is visible here rather than discoverable by reading two files.

  `data-t` sets textContent; `data-th` sets innerHTML, and is spelled out rather
  than inferred, so a translation that happens to contain an angle bracket
  cannot silently promote itself from text to markup. Nothing here interpolates
  input — every value is a literal in this table.
*/
const T = {
  'nav.chip':     { en: 'Open source · MIT',   zh: '开源 · MIT' },
  'nav.work':     { en: 'Work',                zh: '能力' },
  'nav.sandbox':  { en: 'The sandbox',         zh: '沙箱' },
  'nav.run':      { en: 'Get started',         zh: '开始' },
  'nav.cta':      { en: 'Get started for free', zh: '免费开始' },

  'hero.h1':      { en: 'Agent in SANDBOX',     zh: '让 agent 住进沙箱' },
  'hero.built':   { en: 'Built on DeepSeek Harness', zh: '基于 DeepSeek Harness' },
  'hero.cta1':    { en: 'Get started for free', zh: '免费开始' },
  'hero.cta2':    { en: 'Read the source',     zh: '查看源码' },

  'app.new':      { en: 'New session',         zh: '新会话' },
  'app.workspace':{ en: 'Workspace',           zh: '工作区' },
  'app.session':  { en: 'New session',         zh: '新会话' },
  'app.sandbox':  { en: 'Sandbox',             zh: '沙箱' },
  'app.running':  { en: 'Running',             zh: '运行中' },
  'app.mem':      { en: 'MEM',                 zh: '内存' },
  'app.disk':     { en: 'DISK',                zh: '磁盘' },
  'app.name':     { en: 'hammy',               zh: 'hammy' },
  'app.plan':     { en: 'Free plan',           zh: 'Free 套餐' },
  'app.greet':    { en: 'What are we building today?', zh: '今天想构建点什么？' },
  'app.free':     { en: 'Free',                zh: '免费' },
  'app.ask':      { en: 'Describe what you want to build', zh: '描述你想要构建的内容' },
  'app.send':     { en: 'Send',                zh: '发送' },
  'app.access':   { en: 'Full access',         zh: '完全权限' },
  'app.model':    { en: 'DeepSeek-V4-Pro · High', zh: 'DeepSeek-V4-Pro · High' },
  'app.s1':       { en: 'Build a website',     zh: '做一个网站' },
  'app.s2':       { en: 'Research a topic',    zh: '调研一个主题' },
  'app.s3':       { en: 'Clean up a dataset',  zh: '清洗一份数据' },
  'app.s4':       { en: 'Ship a script',       zh: '写个脚本跑起来' },
  'app.s5':       { en: 'Read a repository',   zh: '读一个仓库' },

  'work.h2':      { en: 'The DSH you already know', zh: '你已经熟悉的 DSH' },
  'work.lede':    { en: 'The experience does not change — only where it runs.',
                    zh: '体验不变，变的只是它跑在哪。' },
  'work.w1h':     { en: 'Product launch landing page', zh: '产品上线落地页' },
  'work.w1b':     { en: 'From a sentence to pages you can open.', zh: '从一句话到能打开的页面。' },
  'work.w2h':     { en: 'Competitive research brief', zh: '竞品调研简报' },
  'work.w2b':     { en: 'Sources, notes, and a write-up you can send.', zh: '来源、笔记，和一份能发出去的成稿。' },
  'work.w3h':     { en: 'Weekly sales table, cleaned', zh: '清洗好的周销售表' },
  'work.w3b':     { en: 'Clean, join, export. The files stay in the sandbox.', zh: '清理、拼接、导出，文件留在沙箱里。' },
  'work.w4h':     { en: 'A nightly report that runs', zh: '每晚自动跑的报表' },
  'work.w4b':     { en: 'Install, build, run — on the same machine.', zh: '安装、构建、运行，就在这台机器上。' },
  'work.w5h':     { en: 'Read a repository',   zh: '读一个仓库' },
  'work.w5b':     { en: 'Clone, search, patch.', zh: '克隆、搜索、改代码。' },
  'value.h2':     { en: 'Everyone gets a sandbox.', zh: '每个人分到一个沙箱。' },
  'value.lede':   { en: 'One per account: a shell, a filesystem, a network. Close your laptop — it keeps working.',
                    zh: '一个账号一个：有终端、有文件系统、能联网。合上笔记本，它照样干活。' },
  'value.c1h':    { en: 'Same DSH',            zh: '体验不变' },
  'value.c1b':    { en: 'The interface you already know.', zh: '还是你熟悉的界面，不用重学。' },
  'value.c2h':    { en: 'Swap what it runs on', zh: '底层运行时可替换' },
  'value.c2b':    { en: 'Docker or CubeSandbox, over an E2B-compatible API.', zh: 'Docker 或 CubeSandbox，走 E2B 兼容 API。' },
  'value.c3h':    { en: 'Not your laptop',     zh: '不占你自己的电脑' },
  'value.c3b':    { en: 'Keeps working even when your computer is off.', zh: '电脑关了也还在干活。' },
  'value.c4h':    { en: 'Models, ready to go',  zh: '模型开箱即用' },
  'value.c4b':    { en: 'Configured already. Or bring your own key.', zh: '默认就配好了，也可以换成自己的 Key。' },

  'run.h2':       { en: 'Choose how to run DSH', zh: '选择 DSH 的运行方式' },
  'run.lede':     { en: 'Use the hosted service, or deploy it to your own cloud.', zh: '直接使用托管版，或部署到自己的云上。' },
  'run.ah':       { en: 'Start on ours',       zh: '直接用我们的' },
  'run.a1':       { en: 'Open a browser. Nothing to install.',
                    zh: '打开浏览器就能用，不用安装。' },
  'run.a2':       { en: 'Your own computer can be off. The sandbox keeps running.',
                    zh: '你的电脑关了，沙箱还在跑。' },
  'run.a3':       { en: 'Files and sessions are there next time.',
                    zh: '文件和会话都在，下次接着做。' },
  'run.acta':     { en: 'Get started for free', zh: '免费开始' },
  'run.bh':       { en: 'Or run it on your own cloud', zh: '或部署到自己的云上' },
  'run.b1':       { en: 'Every line is public.', zh: '每一行代码都是公开的。' },
  'run.b2':       { en: 'Docker to try it, CubeSandbox microVMs in production.', zh: '试跑用 Docker，生产用 CubeSandbox 微虚机。' },
  'run.b3':       { en: 'Your credentials, your data, your perimeter.', zh: '你的密钥、你的数据、你的边界。' },

  'term.tab1':    { en: 'Docker',              zh: 'Docker' },
  'term.tab2':    { en: 'CubeSandbox',         zh: 'CubeSandbox' },
  'term.c1':      { en: '# containers on one host — for a trial run',
                    zh: '# 单机容器——用于试跑' },
  'term.c2':      { en: '# a microVM per person — what production runs',
                    zh: '# 一人一台微虚机——生产环境的形态' },

  'close.h2':     { en: 'Ready to run DSH in the cloud?', zh: '准备好在云上用 DSH 了吗？' },
  'close.cta1':   { en: 'Get started for free', zh: '免费开始' },
  'close.cta2':   { en: 'Star on GitHub',      zh: '去 GitHub 点个 Star' },

  'notice.body':  { en: '<strong>HamsterHQ is an independently developed, unofficial project. HamsterHQ and DSH are not products of the same company or organization.</strong> This project is not affiliated with, sponsored by, endorsed by, or maintained by DeepSeek AI, the <code>deepseek-ai</code> organization, Tencent Cloud, or the maintainers of DSH or CubeSandbox. Their names and marks are used only to identify interoperability and upstream dependencies; this project claims no ownership of them.',
                    zh: '<strong>HamsterHQ 是独立开发维护的非官方项目。HamsterHQ 与 DSH 不是同一家公司或组织的产品。</strong>本项目不隶属于、不代表，也未获得 DeepSeek AI、GitHub 上的 <code>deepseek-ai</code> 组织、腾讯云、DSH 或 CubeSandbox 维护方的赞助、背书或维护。文中相关名称与标识仅用于说明兼容性和上游依赖；本项目不主张对其享有任何权利。' },

  'foot.dsh':     { en: 'DeepSeek Harness',    zh: 'DeepSeek Harness' },
  // Served by the deployment rather than by this file: on GitHub Pages, where
  // this page is also published, they are the same kind of link as the sign-in
  // button beside them.
  'foot.wechat':  { en: 'WeChat Official Account', zh: '微信公众号' },
  'foot.scan':    { en: 'Scan to follow',      zh: '微信扫码关注' },
  'foot.terms':   { en: 'Terms',               zh: '服务条款' },
  'foot.privacy': { en: 'Data notice',         zh: '数据处理说明' },
  'foot.security':{ en: 'Safe use',            zh: '安全使用政策' },

  'copy.idle':    { en: 'Copy',                zh: '复制' },
  'copy.done':    { en: 'Copied',              zh: '已复制' },

  'nav.theme':    { en: 'Switch between light and dark', zh: '切换深色/浅色' },

  'doc.title':    { en: 'HamsterHQ — Agent in SANDBOX', zh: 'HamsterHQ — 让 agent 住进沙箱' },
}

/*
  English is what the markup already says, so a visitor with no JavaScript and a
  crawler both get a complete page. Applying a language only rewrites it.
*/
let lang = 'en'

function apply(next) {
  lang = next
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
  document.title = T['doc.title'][next]
  for (const el of document.querySelectorAll('[data-t]')) {
    const entry = T[el.dataset.t]
    if (entry) el.textContent = entry[next]
  }
  for (const el of document.querySelectorAll('[data-th]')) {
    const entry = T[el.dataset.th]
    if (entry) el.innerHTML = entry[next]
  }
  // Attributes, not content: a placeholder and a label have to be translated
  // too, and neither is reachable through textContent.
  for (const el of document.querySelectorAll('[data-tp]')) {
    const entry = T[el.dataset.tp]
    if (entry) { el.placeholder = entry[next]; el.setAttribute('aria-label', entry[next]) }
  }
  for (const el of document.querySelectorAll('[data-ta]')) {
    const entry = T[el.dataset.ta]
    if (entry) el.setAttribute('aria-label', entry[next])
  }
  for (const button of document.querySelectorAll('.lang button')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === next))
  }
  try { localStorage.setItem('dshcloud.lang', next) } catch { /* private mode */ }
}

let stored = null
try { stored = localStorage.getItem('dshcloud.lang') } catch { /* private mode */ }
apply(stored === 'zh' || stored === 'en' ? stored : (navigator.language || '').startsWith('zh') ? 'zh' : 'en')

for (const button of document.querySelectorAll('.lang button')) {
  button.addEventListener('click', () => apply(button.dataset.lang))
}

/* ---------- light or dark ---------- */

/*
  The choice is already applied — an inline script in the head does that before
  first paint, so a page asked for dark never flashes white. This only handles
  the click.

  Stored under the same key the sign-in page uses, so a visitor who picks dark
  here does not meet a white form one link later.
*/
document.getElementById('theme').addEventListener('click', () => {
  // Reads what is rendered rather than what was stored, so the first click on a
  // page that is dark only because the system is dark goes to light, rather
  // than setting dark again and appearing to do nothing.
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  const current = document.documentElement.dataset.theme || (dark ? 'dark' : 'light')
  const next = current === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  try { localStorage.setItem('dsh-theme', next) } catch { /* private mode */ }
})

/* ---------- the two install paths ---------- */

for (const tab of document.querySelectorAll('.tabs button')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.tabs button')) {
      const on = other === tab
      other.setAttribute('aria-selected', String(on))
      document.getElementById(`t-${other.dataset.tab}`).classList.toggle('on', on)
    }
  })
}

/* ---------- copy ---------- */

for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', async () => {
    // The visible block rather than a fixed id: the two are stacked in one cell
    // and the one to copy is whichever tab is showing.
    const block = button.closest('.term').querySelector('pre.on')
    const label = button.querySelector('span')
    // The prompt is the one part nobody wants pasted into their shell, so the
    // `$` spans are dropped by class rather than by stripping a leading
    // character — a command that legitimately starts with `$` would not
    // survive the second approach.
    const text = [...block.childNodes]
      .filter((node) => !(node.nodeType === 1 && node.classList.contains('p')))
      .map((node) => node.textContent)
      .join('')
      .split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      label.textContent = T['copy.done'][lang]
      setTimeout(() => { label.textContent = T['copy.idle'][lang] }, 1400)
    } catch {
      // Clipboard access needs a secure context, and a deployment reached over
      // plain HTTP at a LAN address is not one. Selecting the block is the
      // honest fallback: the person can still press the shortcut.
      const range = document.createRange()
      range.selectNodeContents(block)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    }
  })
}

/* ---------- the composer ---------- */

/*
  The button already submits without any of this. All the script adds is Enter
  as a second way to press it — and Shift+Enter left alone, because a composer
  that cannot hold two lines is not one.
*/
;(() => {
  const form = document.querySelector('.composer')
  const field = form && form.querySelector('.ask')
  if (!field) return
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    if (form.requestSubmit) form.requestSubmit()
    else form.submit()
  })
})()

/* ---------- the suggestions ---------- */

/*
  A suggestion fills the box rather than leaving for the sign-in page, because
  the box is now the thing that leaves. Without scripting they stay ordinary
  links to /login, which is the same destination by a shorter road.
*/
;(() => {
  const field = document.querySelector('.composer .ask')
  if (!field) return
  for (const chip of document.querySelectorAll('.suggestions a')) {
    chip.addEventListener('click', (event) => {
      event.preventDefault()
      field.value = chip.textContent.trim()
      field.focus()
    })
  }
})()

/* ---------- the field behind the page ---------- */

/*
  A lattice of points, each held to its rest position by a spring and pushed
  away by the cursor. Ported from the model on deepseek.com/harness, whose
  constants are kept below exactly as they are there — 90px cells, a 140px
  reach, a peak push of 30, a 0.05 spring and 0.85 damping, capped at 30fps.
  The feel lives entirely in the ratio between the push and the spring, and
  every value has been tuned against the others.

  Two things make it cheap enough to leave running behind the whole page. It
  sleeps as soon as the lattice has settled and wakes on the next mouse move, so
  a page nobody is touching costs nothing at all. And where it cannot be driven
  — a touch screen, or a reader who asked for stillness — it draws one static
  frame, because this is the ground, not an effect laid over one.
*/
;(() => {
  const canvas = document.getElementById('field')
  const context = canvas && canvas.getContext('2d')
  if (!context) return

  const SPACING = 90        // cell size, CSS pixels
  const REACH = 140         // how far from the cursor a point feels anything
  const PUSH = 30           // peak force, at the cursor itself
  const SPRING = 0.05       // pull back towards rest
  const DAMPING = 0.85
  const GAP = 10            // drawn gap at each end of a segment
  const FRAME = 1000 / 30
  const ASLEEP = 0.01       // below this much motion there is nothing left to draw

  const idle = matchMedia('(hover: none), (pointer: coarse)').matches
    || matchMedia('(prefers-reduced-motion: reduce)').matches

  let ratio = 1, width = 0, height = 0, columns = 0, rows = 0
  let points = []
  let line = 'rgba(16,17,19,.055)', dot = 'rgba(16,17,19,.10)', accent = '10 125 85'
  let sleeping = false, previous = 0, pending = 0
  const cursor = { x: NaN, y: NaN }

  function readTokens() {
    const style = getComputedStyle(document.documentElement)
    line = style.getPropertyValue('--grid-line').trim() || line
    dot = style.getPropertyValue('--grid-dot').trim() || dot
    accent = style.getPropertyValue('--accent-rgb').trim() || accent
  }

  function build() {
    columns = Math.ceil(width / SPACING) + 1
    rows = Math.ceil(height / SPACING) + 1
    // Centred, so the lattice is not pinned to one corner as the window changes.
    const originX = (width - (columns - 1) * SPACING) / 2
    const originY = (height - (rows - 1) * SPACING) / 2
    points = []
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = originX + column * SPACING
        const y = originY + row * SPACING
        points.push({ restX: x, restY: y, x, y, vx: 0, vy: 0 })
      }
    }
  }

  function resize() {
    ratio = Math.min(devicePixelRatio || 1, 2)
    width = canvas.clientWidth
    height = canvas.clientHeight
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    build()
  }

  function segment(a, b) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (length < GAP * 2) return
    const ux = dx / length
    const uy = dy / length
    context.moveTo(a.x + GAP * ux, a.y + GAP * uy)
    context.lineTo(b.x - GAP * ux, b.y - GAP * uy)
  }

  /** @returns {number} the fastest point this frame, which is what decides sleep. */
  function draw() {
    const mx = cursor.x
    const my = cursor.y
    const chased = !Number.isNaN(mx)
    let fastest = 0

    for (const point of points) {
      if (chased) {
        const dx = point.x - mx
        const dy = point.y - my
        const distance = Math.hypot(dx, dy)
        if (distance < REACH && distance > 0.1) {
          const force = (1 - distance / REACH) * PUSH * 0.1
          point.vx += (dx / distance) * force
          point.vy += (dy / distance) * force
        }
      }
      point.vx = (point.vx + SPRING * (point.restX - point.x)) * DAMPING
      point.vy = (point.vy + SPRING * (point.restY - point.y)) * DAMPING
      point.x += point.vx
      point.y += point.vy
      const speed = Math.abs(point.vx) + Math.abs(point.vy)
      if (speed > fastest) fastest = speed
    }

    context.clearRect(0, 0, width, height)

    // Every segment in one path: a few hundred strokes a frame is the one thing
    // here that would show up in a profile, and batching makes it one.
    context.strokeStyle = line
    context.lineWidth = 0.5
    context.beginPath()
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns - 1; column++) {
        segment(points[row * columns + column], points[row * columns + column + 1])
      }
    }
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows - 1; row++) {
        segment(points[row * columns + column], points[(row + 1) * columns + column])
      }
    }
    context.stroke()

    // Squares rather than arcs, as upstream draws them: at this size the shape
    // does not read, and `fillRect` skips a path per point.
    context.fillStyle = dot
    for (const point of points) {
      context.fillRect(point.x - 1.8, point.y - 1.8, 3.6, 3.6)
    }

    // A second pass over only what the cursor is near, tinting those points
    // towards the accent as they grow. Overdrawing is what blends the two
    // colours — interpolating them would mean parsing both.
    if (chased) {
      for (const point of points) {
        const near = 1 - Math.hypot(point.x - mx, point.y - my) / REACH
        if (near <= 0) continue
        const half = 1.8 + 2 * near
        context.fillStyle = `rgb(${accent} / ${(0.45 * near).toFixed(3)})`
        context.fillRect(point.x - half, point.y - half, half * 2, half * 2)
      }
    }

    return fastest
  }

  function tick(now) {
    if (now - previous < FRAME) { requestAnimationFrame(tick); return }
    previous = now - (now - previous) % FRAME

    if (canvas.clientWidth !== width || canvas.clientHeight !== height) resize()

    if (draw() < ASLEEP) sleeping = true
    else requestAnimationFrame(tick)
  }

  function wake() {
    if (!sleeping) return
    sleeping = false
    previous = 0
    requestAnimationFrame(tick)
  }

  readTokens()
  resize()

  if (idle) {
    draw()
    addEventListener('resize', () => {
      clearTimeout(pending)
      pending = setTimeout(() => { resize(); draw() }, 150)
    })
  } else {
    requestAnimationFrame(tick)
    addEventListener('mousemove', (event) => {
      const box = canvas.getBoundingClientRect()
      cursor.x = event.clientX - box.left
      cursor.y = event.clientY - box.top
      wake()
    }, { passive: true })
    addEventListener('resize', () => {
      clearTimeout(pending)
      pending = setTimeout(() => { resize(); wake() }, 150)
    })
  }

  // The colours are read once, so a system that flips theme while the page is
  // open would otherwise keep drawing in the old one.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    readTokens()
    if (sleeping || idle) draw()
  })
})()
