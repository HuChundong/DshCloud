/*
  Both languages, one line per string. A key present on one side and missing on
  the other is visible here rather than discoverable by reading two files.

  `data-t` sets textContent; `data-th` sets innerHTML, and is spelled out rather
  than inferred, so a translation that happens to contain an angle bracket
  cannot silently promote itself from text to markup. Nothing here interpolates
  input — every value is a literal in this table.

  WRITE THE COPY, DO NOT COLLECT IT. Every string here is this project's own
  sentence. Reading what other products say is how anyone learns to write a
  landing page, and the ORDER a page argues in is a layout decision nobody
  owns — but a sentence is the part that is owned, so none is taken from
  another company's page, in either language. That is a rule about this file
  rather than a general opinion: the strings are short, the claims are the same
  claims every product in this category makes, and it is genuinely easy to end
  up with someone else's line in here without meaning to.

  The register is stated so it does not drift string by string: measured and
  written rather than spoken. Chinese uses 您 and full sentences; English is
  plain and specific and never breezy. Buttons are the exception in both — a
  control is terse at any register.
*/
const T = {
  'nav.chip':     { en: 'Open source · MIT',   zh: '开源 · MIT' },
  'nav.work':     { en: 'Work',                zh: '能力' },
  'nav.sandbox':  { en: 'The sandbox',         zh: '沙箱' },
  'nav.plans':    { en: 'Plans',               zh: '套餐' },
  'nav.run':      { en: 'Get started',         zh: '开始' },
  'nav.cta':      { en: 'Start free',           zh: '免费开始' },

  // Set by the person who owns this deployment, and it is the harness's own
  // line. The rule at the top of this file — that every sentence here is this
  // project's own — does not hold for this one, and the notice at the foot of
  // the page states that this is an unofficial project. Both are recorded here
  // rather than quietly reconciled, because the next person to read this file
  // will otherwise take the rule to have been abandoned.
  'hero.h1':      { en: 'Everything is a plugin, build your agent', zh: '一切皆插件，打造你的Agent' },
  'hero.built':   { en: 'Built on DeepSeek Harness', zh: '基于 DeepSeek Harness' },
  // The calls to action stay short in both languages. Terse is what a button
  // is, at any register; lengthening these would be formality worn as padding.
  'hero.cta1':    { en: 'Start free',           zh: '免费开始' },
  'hero.cta2':    { en: 'View the source',     zh: '查看源代码' },

  'app.new':      { en: 'New session',         zh: '新会话' },
  'app.workspace':{ en: 'Workspace',           zh: '工作区' },
  'app.session':  { en: 'New session',         zh: '新会话' },
  'app.sandbox':  { en: 'Sandbox',             zh: '沙箱' },
  'app.running':  { en: 'Running',             zh: '运行中' },
  // The words the product's own rings use. This still is a picture of the
  // workspace someone gets after signing in, so a label here that the
  // application does not have is a picture of a different product — the two
  // were `MEM`/`DISK` here and `RAM`/`Disk` there, and these are the pair kept.
  'app.mem':      { en: 'MEM',                 zh: '内存' },
  'app.disk':     { en: 'DISK',                zh: '磁盘' },
  'app.name':     { en: 'hammy',               zh: 'hammy' },
  // The mock-up shows a signed-in workspace, so it has to show a tier that
  // exists — and the honest one is the tier a visitor who presses the button
  // beside it actually lands on. `预览版` was neither: it was this deployment
  // saying it had no tiers, on a page that now lists three.
  'app.plan':     { en: 'Free',                zh: '免费' },
  'app.greet':    { en: 'What are we building today?', zh: '今天想构建点什么？' },
  'app.ask':      { en: 'Describe what you want to build', zh: '描述你想要构建的内容' },
  'app.send':     { en: 'Send',                zh: '发送' },
  'app.access':   { en: 'Full access',         zh: '完全权限' },
  'app.model':    { en: 'DeepSeek-V4-Pro · High', zh: 'DeepSeek-V4-Pro · High' },
  'app.s1':       { en: 'Build a website',     zh: '做一个网站' },
  'app.s2':       { en: 'Research a topic',    zh: '调研一个主题' },
  'app.s3':       { en: 'Clean up a dataset',  zh: '清洗一份数据' },
  'app.s4':       { en: 'Ship a script',       zh: '写个脚本跑起来' },
  'app.s5':       { en: 'Read a repository',   zh: '读一个仓库' },

  'work.h2':      { en: 'The DSH you already know', zh: '您已经熟悉的 DSH' },
  'work.lede':    { en: 'The experience does not change — only where it runs.',
                    zh: '使用体验保持不变，改变的只是它运行的位置。' },
  'work.w1h':     { en: 'Product launch landing page', zh: '产品上线落地页' },
  'work.w1b':     { en: 'From one description to pages you can open.', zh: '从一句需求描述，到可直接打开的页面。' },
  'work.w2h':     { en: 'Competitive research brief', zh: '竞品调研简报' },
  'work.w2b':     { en: 'Sources, notes, and a write-up ready to send.', zh: '来源、笔记，以及一份可直接发送的成稿。' },
  'work.w3h':     { en: 'Weekly sales table, cleaned', zh: '清洗完成的周度销售表' },
  'work.w3b':     { en: 'Clean, join and export — the files remain in the sandbox.', zh: '清洗、合并、导出，文件始终保留在沙箱内。' },
  // Not "a nightly report", which is what this said. Nothing in this
  // deployment schedules anything: a sandbox is reclaimed once it has been
  // idle, so a cron line inside one does not survive to fire. The card is
  // about the machine being real enough to install onto and run on, which is
  // true — and it stops promising the one thing that is not.
  'work.w4h':     { en: 'A report that actually runs', zh: '真的跑得起来的报表' },
  'work.w4b':     { en: 'Install, build and run — all on the same machine.', zh: '安装、构建、运行，全部在同一台机器上完成。' },
  'work.w5h':     { en: 'Read a repository',   zh: '读取一个代码仓库' },
  'work.w5b':     { en: 'Clone, search and patch.', zh: '克隆、检索、修改代码。' },
  // The heading states the arrangement and the lede states what it consists
  // of. They both said "one per account" before, which spent the lede's
  // sentence repeating the heading above it.
  'value.h2':     { en: 'Every account gets a sandbox of its own.', zh: '每个账号独享一台沙箱。' },
  'value.lede':   { en: 'A full shell, a filesystem and network access. Work continues once your own machine goes offline.',
                    zh: '具备完整的终端、文件系统与网络访问能力。本地设备离线后，任务仍持续执行。' },
  'value.c1h':    { en: 'Same DSH',            zh: '体验保持一致' },
  'value.c1b':    { en: 'The interface you already know — nothing to relearn.', zh: '仍是您已经熟悉的界面，无需重新学习。' },
  'value.c2h':    { en: 'A replaceable runtime', zh: '运行时可替换' },
  'value.c2b':    { en: 'Docker or CubeSandbox, over an E2B-compatible API.', zh: 'Docker 或 CubeSandbox，通过 E2B 兼容接口接入。' },
  'value.c3h':    { en: 'Not your own machine', zh: '不占用本地设备' },
  'value.c3b':    { en: 'It keeps running once your own machine is off.', zh: '本地设备离线后仍持续运行。' },
  'value.c4h':    { en: 'Models, ready to use',  zh: '模型开箱即用' },
  'value.c4b':    { en: 'Configured by default, or supply your own key.', zh: '默认已完成配置，也可替换为您自己的密钥。' },

  // The trust section, and it carries no numbers.
  //
  // A count of users or models would be the conventional thing here and this
  // deployment has none it could state truthfully — an operator running it on
  // their own hardware has whatever they have. What it does have is a property
  // no closed product can offer: every claim below names something a reader can
  // go and read. So the section is claims-with-receipts rather than statistics,
  // and each one is qualified where the runtime changes the answer.
  'proof.h2':     { en: 'Every claim here can be checked', zh: '这里的每一条都可以自己核对' },
  'proof.lede':   { en: 'This project is open source, so each of the following can be traced to the code that makes it true.',
                    zh: '本项目开源，下述每一项均可在代码中查证。' },
  'proof.c1h':    { en: 'Open source, in full', zh: '开源，且是完整的' },
  'proof.c1b':    { en: 'Authentication, isolation, reclamation — every line of it is public. Nothing is described only in the documentation.',
                    zh: '认证、隔离、回收——每一行都是公开的。不存在只写在文档里的部分。' },
  'proof.c2h':    { en: 'Isolation is machine isolation', zh: '隔离是机器级的' },
  'proof.c2b':    { en: 'One machine per account: a microVM under CubeSandbox, a container under Docker. Never two tenants inside one process.',
                    zh: '一个账号一台机器：CubeSandbox 下是微虚机，Docker 下是容器。绝不会是同一进程里的两个租户。' },
  'proof.c3h':    { en: 'The model credential stays out', zh: '模型密钥不进沙箱' },
  'proof.c3b':    { en: 'On runtimes that support it, the sandbox holds a placeholder and the real key is substituted as the request leaves. Prompt injection cannot reach what was never there.',
                    zh: '在支持的运行时上，沙箱内只有占位符，真实密钥在请求离开时才被替换。提示注入拿不到一个从未存在过的东西。' },
  'proof.c4h':    { en: 'No third parties',    zh: '不接第三方' },
  'proof.c4b':    { en: 'No CDN, no analytics, no tracking script. This page is not an exception — open the network panel and see.',
                    zh: '没有 CDN、没有统计、没有追踪脚本。这一页也不例外——打开网络面板即可验证。' },

  'plans.h2':     { en: 'Choose a plan',       zh: '选择适合您的套餐' },
  'plans.lede':   { en: 'Every account starts on the free plan. The paid tiers are opening; deploying it yourself is open source and free, permanently.',
                    zh: '所有账号均从免费版开始。付费档位正在开放中；自行部署始终开源且免费。' },
  'plans.pick':   { en: 'Recommended',         zh: '推荐' },
  // One string for all three tiers that have one: what they include is the same
  // undecided thing, and three copies of it would be three places to edit on
  // the day it is decided.
  'plans.tbd':    { en: 'The capabilities included in each tier are still being settled. This space is reserved for them.',
                    zh: '各档位包含的具体能力尚在确定中，此处为其预留。' },
  'plans.soon':   { en: 'Not yet available',   zh: '尚未开放' },

  'plans.free.h':     { en: 'Free',            zh: '免费' },
  'plans.free.b':     { en: 'Available on registration.', zh: '注册后即可使用。' },
  'plans.free.price': { en: '¥0',              zh: '¥0' },
  'plans.free.note':  { en: 'Free, permanently', zh: '永久免费' },
  'plans.free.cta':   { en: 'Get started',     zh: '开始使用' },

  'plans.pro.h':      { en: 'Pro',             zh: '专业' },
  'plans.pro.b':      { en: 'For those who use it every day.', zh: '面向每日持续使用的用户。' },
  'plans.pro.price':  { en: 'Coming soon',     zh: '敬请期待' },
  'plans.pro.note':   { en: 'Price to be announced', zh: '定价待定' },

  'plans.team.h':     { en: 'Team',            zh: '团队' },
  'plans.team.b':     { en: 'One sandbox per member, across a whole team.', zh: '团队成员各自独享一台沙箱。' },
  'plans.team.price': { en: 'Coming soon',     zh: '敬请期待' },
  'plans.team.note':  { en: 'Per seat',        zh: '按席位计费' },

  'plans.self.h':     { en: 'Deploy it yourself', zh: '自行部署' },
  'plans.self.b':     { en: 'On your own cloud, under your own rules.', zh: '部署在您自己的云上，规则由您制定。' },
  'plans.self.price': { en: 'Open source, no charge', zh: '开源免费' },
  // The licence's own name, which is spelled the American way and carries a
  // capital L — a proper noun rather than the common noun the rest of this
  // page's British spelling would ask for.
  'plans.self.note':  { en: 'MIT License',     zh: 'MIT 协议' },
  'plans.self.a':     { en: 'No account here, and no billing.', zh: '无需在此注册账号，也不会产生账单。' },
  'plans.self.b2':    { en: 'As many sandboxes as your own hardware allows.', zh: '可运行的沙箱数量取决于您自己的硬件。' },
  'plans.self.c':     { en: 'Yours to deploy, and yours to maintain.', zh: '部署与运维均由您自行负责。' },
  'plans.self.cta':   { en: 'How to deploy',   zh: '部署方式' },

  'plans.foot':   { en: 'The paid tiers are not yet available for purchase, and this page takes no payment. Tiers are granted and changed by the deployment’s administrator; the WeChat Official Account in the footer is where to enquire.',
                    zh: '付费档位尚未开放购买，本页面不涉及任何支付。档位的开通与变更由部署管理员操作；如有需要，可通过页脚的公众号与我们联系。' },

  'run.h2':       { en: 'Choose how to run DSH', zh: '选择 DSH 的运行方式' },
  'run.lede':     { en: 'Use the hosted service, or deploy it to a cloud of your own.', zh: '直接使用托管服务，或部署至您自己的云环境。' },
  'run.ah':       { en: 'Use our hosted service', zh: '使用我们的托管服务' },
  'run.a1':       { en: 'Open a browser — there is nothing to install.',
                    zh: '打开浏览器即可使用，无需安装。' },
  // Not a second telling of `value.c3b`. That card is the claim; this line is
  // what it means for the person setting one up, which is that the machine in
  // front of them is not the one doing the work.
  'run.a2':       { en: 'The work is not on the machine in front of you, so closing it changes nothing.',
                    zh: '任务并不运行在您眼前这台机器上，关掉它不影响任何事。' },
  'run.a3':       { en: 'Files and sessions are preserved for the next visit.',
                    zh: '文件与会话均予保留，下次可继续。' },
  'run.acta':     { en: 'Start free',           zh: '免费开始' },
  'run.bh':       { en: 'Or deploy it to a cloud of your own', zh: '或部署至您自己的云环境' },
  'run.b1':       { en: 'Every line of it is public.', zh: '每一行代码均已公开。' },
  'run.b2':       { en: 'Docker for a trial run, CubeSandbox microVMs in production.', zh: '测试环境可采用 Docker，生产环境建议采用 CubeSandbox 微虚机。' },
  'run.b3':       { en: 'Your credentials, your data, your perimeter.', zh: '您的密钥、您的数据、您的边界。' },

  'term.tab1':    { en: 'Docker',              zh: 'Docker' },
  'term.tab2':    { en: 'CubeSandbox',         zh: 'CubeSandbox' },
  'term.c1':      { en: '# containers on one host — for a trial run',
                    zh: '# 单机容器——用于试跑' },
  'term.c2':      { en: '# a microVM per person — what production runs',
                    zh: '# 一人一台微虚机——生产环境的形态' },

  'close.h2':     { en: 'Run DSH in the cloud.', zh: '在云上运行 DSH。' },
  'close.cta1':   { en: 'Start free',           zh: '免费开始' },
  'close.cta2':   { en: 'Star it on GitHub',   zh: '前往 GitHub 加星' },

  'notice.body':  { en: '<strong>HamsterHQ is an independently developed, unofficial project. HamsterHQ and DSH are not products of the same company or organization.</strong> This project is not affiliated with, sponsored by, endorsed by, or maintained by DeepSeek AI, the <code>deepseek-ai</code> organization, Tencent Cloud, or the maintainers of DSH or CubeSandbox. Their names and marks are used only to identify interoperability and upstream dependencies; this project claims no ownership of them.',
                    zh: '<strong>HamsterHQ 是独立开发维护的非官方项目。HamsterHQ 与 DSH 不是同一家公司或组织的产品。</strong>本项目不隶属于、不代表，也未获得 DeepSeek AI、GitHub 上的 <code>deepseek-ai</code> 组织、腾讯云、DSH 或 CubeSandbox 维护方的赞助、背书或维护。文中相关名称与标识仅用于说明兼容性和上游依赖；本项目不主张对其享有任何权利。' },

  'foot.dsh':     { en: 'DeepSeek Harness',    zh: 'DeepSeek Harness' },
  // Served by the deployment rather than by this file: on GitHub Pages, where
  // this page is also published, they are the same kind of link as the sign-in
  // button beside them.
  'foot.wechat':  { en: 'WeChat Official Account', zh: '微信公众号' },
  'foot.scan':    { en: 'Scan to follow',      zh: '微信扫码关注' },
  // Shortened, but still the documents' names — so they keep the capitals the
  // full titles have. `Data notice` and `Safe use` read as descriptions of a
  // thing rather than as what the thing is called.
  'foot.terms':   { en: 'Terms',               zh: '服务条款' },
  'foot.privacy': { en: 'Data Notice',         zh: '数据处理说明' },
  'foot.security':{ en: 'Safe Use',            zh: '安全使用政策' },

  'copy.idle':    { en: 'Copy',                zh: '复制' },
  'copy.done':    { en: 'Copied',              zh: '已复制' },

  'nav.theme':    { en: 'Switch between light and dark', zh: '切换深色/浅色' },

  // The headline again, and it has to be the headline: a tab that says one
  // thing and a page that says another is two names for one product. The
  // reason the Chinese above stopped saying 住进 applies here unchanged.
  'doc.title':    { en: 'HamsterHQ — Everything is a plugin', zh: 'HamsterHQ — 一切皆插件，打造你的Agent' },
}

/*
  English is what the markup already says, so a visitor with no JavaScript and a
  crawler both get a complete page. Applying a language only rewrites it.
*/
let lang = 'en'

/**
 * Where the choice of language is kept.
 *
 * The same key the gateway's own pages use, which is the whole point: this
 * page and the sign-in form behind it are one deployment to the person reading
 * them, and they were keeping the answer in two different places — so choosing
 * 中文 here and pressing the button turned the next page back to English.
 *
 * `FORMER_KEY` is read once, for the visitors who chose before the two agreed.
 * They get their choice back and it is written where both sides look.
 */
const LANG_KEY = 'dsh-lang'
const FORMER_KEY = 'dshcloud.lang'

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
  try { localStorage.setItem(LANG_KEY, next) } catch { /* private mode */ }
}

let stored = null
try { stored = localStorage.getItem(LANG_KEY) ?? localStorage.getItem(FORMER_KEY) } catch { /* private mode */ }
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
