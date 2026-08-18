/**
 * The tenant's account, browser half.
 *
 * Registered into `settings.section`, the list slot the Settings shell declares
 * for its pages, so the account lives where every other configuration page
 * does. `order` puts it after the shipped sections (general, models, plugins,
 * agent presets), which register at lower positions.
 *
 * Both facts it shows come from the gateway, not from dsh: the harness has no
 * notion of the deployment's tenants, so `/whoami` names the caller and
 * `/logout` ends the session and releases their sandbox.
 *
 * Written against the module loader the shell installs rather than built from
 * the workspace: `require` here is the shell's module table, which is where
 * React comes from. Nothing in this file resolves through node_modules, so the
 * package needs no build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tenant-account',
  factory: (require) => {
    const React = require('react')
    const ReactDom = require('react-dom')

    /** Class the rule below is scoped to; nothing else in the page uses it. */
    const BUTTON_CLASS = 'dsh-tenant-account-button'

    /**
     * The shell's New Session button, matched.
     *
     * Its own class is a content-hashed CSS-module name private to the sidebar
     * bundle, so it cannot be borrowed — but the tokens it is built from are
     * declared on `body` by the theme, so restating the recipe against them
     * tracks both themes without this file knowing either.
     *
     * Values from `SidebarRoot.module.css`: 38px tall, 12px radius, elevated
     * fill over an l2 border, and the floating-hover fill on hover.
     */
    const BUTTON_CSS = `
      .${BUTTON_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 38px;
        padding: 8px 16px;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 12px;
        background: var(--dsw-alias-button-elevated-fill, #fff);
        color: var(--dsw-alias-label-primary, inherit);
        font-family: inherit;
        font-size: 14px;
        font-weight: 500;
        line-height: 22px;
        cursor: pointer;
      }
      .${BUTTON_CLASS}:hover {
        background: var(--dsw-alias-button-floating-hover, rgb(241 243 245));
      }
      /* The second press of a two-press gesture. Colour rather than a new
          shape, so the control does not move under the pointer between the
          press that asks and the press that answers. */
      .${BUTTON_CLASS}[data-danger='true'] {
        color: var(--dsw-alias-state-error-primary, #ec1313);
        border-color: var(--dsw-alias-state-error-primary, #ec1313);
      }
      .${BUTTON_CLASS}[data-danger='true']:hover {
        background: var(--dsw-alias-interactive-bg-hover-danger, rgb(236 19 19 / 5%));
      }
      .${BUTTON_CLASS}:disabled { opacity: .6; cursor: default; }
    `

    /**
     * An onboarding step that is already finished.
     *
     * Rendered in place of a step this deployment does not want shown. It has
     * to report completion rather than merely render nothing: the shell keeps
     * the queue — and `#root`'s inertness — on whichever step has not completed.
     *
     * @param {{complete: () => void}} props - the step seat, whose `complete` advances the queue.
     * @returns {null} nothing to paint.
     */
    const Skip = ({ complete }) => {
      React.useEffect(() => { complete() }, [complete])
      return null
    }

    /** Post to the gateway's /logout, then leave for the login page. */
    const signOut = async () => {
      // The gateway answers with a redirect, which fetch follows and hands back
      // as HTML, so the navigation happens here rather than from the response.
      await fetch('/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
      globalThis.location.href = '/login'
    }

    /** Marks a nav label that brought its own glyph. */
    const NAV_GLYPH = 'dsh-settings-nav-glyph'

    /** Hides the panel's fallback gear on any cell whose label brought one. */
    const NAV_GLYPH_CSS = `
      button:has(> span > .${NAV_GLYPH}) > svg { display: none; }
    `

    /**
     * A settings-nav label that carries its own glyph.
     *
     * The panel picks its nav icon from a hardcoded list of three section ids
     * and gives everything else the same gear, and its registration contract
     * has no icon field — but `resolveSlotLabel` is `typeof x === 'function' ?
     * x() : x`, so a label is passed through verbatim and may be a node. The
     * glyph therefore rides in on the label, inside the span the panel renders
     * it into.
     *
     * The rule that hides the fallback gear is mounted separately rather than
     * from inside this label: a style tag here would put its CSS into the nav
     * cell's `textContent`, which is the cell's accessible name — a screen
     * reader would read the stylesheet out. It is written structurally — a
     * button whose label holds our marker, hide the svg that is its own direct
     * child — so it names no content-hashed class and survives the panel's
     * styles being rebuilt. If upstream ever changes that shape the worst case
     * is two glyphs, not a broken page.
     *
     * @param {string} d - the path data for a 16px glyph.
     * @param {string} text - the section name.
     * @returns {object} the label node.
     */
    const navLabel = (d, text) => React.createElement(
      React.Fragment,
      null,
      React.createElement(
        'span',
        { className: NAV_GLYPH, style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
        React.createElement('svg', {
          width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
          style: { flex: 'none' }, 'aria-hidden': true,
        }, React.createElement('path', {
          d, stroke: 'currentColor', strokeWidth: 1.3,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        })),
        text,
      ),
    )

    /** What the caller is before their own answer has arrived. */
    const NOBODY = { username: '', admin: false, displayName: '', avatar: '' }

    /**
     * What this deployment charges, which is nothing.
     *
     * Stated rather than fetched, because there is no plan to fetch: no tiers
     * exist, no entitlement is enforced anywhere, and a request for something
     * the gateway has no table for would be inventing an answer. It is a
     * constant so that there is exactly one line to change on the day plans do
     * exist, and so that nothing downstream is written as though they already
     * do.
     */
    const PLAN_LABEL = 'Free 套餐'

    /**
     * The sandbox row `dsh-sandbox-host` puts at the sidebar's foot.
     *
     * Named here because pressing that row opens the settings panel, and this
     * plugin is what holds the seat that opens it — reaching the row means
     * matching the class that plugin scopes its footer to. The dependency runs
     * one way: `dsh-sandbox-host` survives the gateway's removal and knows
     * nothing about this, and a build where that row is absent never fires.
     */
    const SANDBOX_ROW = 'dsh-sandbox-host-sandbox'

    /**
     * The first letter of a name, which is the whole of it that fits in a
     * circle. Spread rather than indexed, so a name starting with an emoji or
     * any other astral character yields that character and not half of it.
     *
     * @param {string} name - the name to reduce.
     * @returns {string} its first character, or the empty string.
     */
    const initialOf = (name) => (name === '' ? '' : [...name][0])

    /**
     * The caller, read once for the page rather than once per component.
     *
     * Two surfaces here want the same answer — the sidebar row and the account
     * section — and both mount on load. The answer now carries an avatar, so
     * asking twice is two reads of the row and two copies of the image for one
     * page; the promise is shared instead, and a reload is what refreshes it.
     */
    let asked
    const listeners = new Set()
    const whoami = () => {
      // An unreadable answer becomes an empty one rather than a rejection, so
      // every caller can treat "not signed in" and "could not tell" alike:
      // neither is a reason to render nothing.
      asked ??= fetch('/whoami', { credentials: 'same-origin' })
        .then((response) => response.json())
        .catch(() => ({}))
      return asked
    }

    /**
     * Ask again, and tell everyone showing the answer.
     *
     * The cache used to be refreshed by reloading the page, which was true
     * while the only way to change a profile was a page that navigated away
     * and came back. Editing in a dialog leaves the page where it is, so the
     * answer has to be able to change under it.
     */
    const refreshWhoami = () => {
      asked = undefined
      void whoami().then(() => { for (const listener of listeners) listener() })
    }

    /**
     * Subscribe to the caller.
     * @returns {{username: string, admin: boolean, displayName: string, avatar: string}} the caller, `NOBODY` until the answer lands.
     */
    const useWhoami = () => {
      const [who, setWho] = React.useState(NOBODY)
      React.useEffect(() => {
        let live = true
        const load = () => void whoami().then((body) => {
          if (!live) return
          setWho({
            username: String(body?.username ?? ''),
            admin: body?.admin === true,
            // Both are null for an account that has not set them, and the empty
            // string is what every reader below tests for.
            displayName: typeof body?.displayName === 'string' ? body.displayName : '',
            avatar: typeof body?.avatar === 'string' ? body.avatar : '',
          })
        })
        load()
        // Re-read when the profile is saved, so the sidebar row and the
        // account page change under the dialog that changed them.
        listeners.add(load)
        return () => { live = false; listeners.delete(load) }
      }, [])
      return who
    }

    /**
     * The environment a tenant asks for in their own sandbox.
     *
     * Belongs to this plugin by the same test as everything else in it: take
     * the gateway away and there is no tenant, no database, and nowhere for a
     * value to live between one sandbox and the next. The page next to this one
     * describes the machine; this one is about what the deployment injects into
     * it on that tenant's behalf.
     *
     * A value is written and never read back — the gateway does not serve one,
     * so there is nothing here to render even by mistake. What a person checks
     * against is the name and when they last set it.
     *
     * @returns {object} the section.
     */
    const SecretsSection = () => {
      const [list, setList] = React.useState(null)
      const [name, setName] = React.useState('')
      const [value, setValue] = React.useState('')
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let live = true
        void fetch('/secrets', { credentials: 'same-origin' })
          .then((response) => response.json())
          .then((body) => { if (live) setList(Array.isArray(body?.secrets) ? body.secrets : []) })
          .catch(() => { if (live) setList([]) })
        return () => { live = false }
      }, [])

      /**
       * Post one change and take the server's list as the new truth.
       *
       * The answer carries the whole list rather than an acknowledgement, so
       * the page never has to guess what the write did — and two tabs editing
       * the same account converge on the next write instead of drifting.
       *
       * @param {string} path - the endpoint.
       * @param {object} payload - what to send.
       * @returns {Promise<boolean>} whether it was accepted.
       */
      const send = async (path, payload) => {
        setBusy(true)
        setError('')
        try {
          const response = await fetch(path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) {
            setError(String(body?.error ?? '操作失败。'))
            return false
          }
          setList(Array.isArray(body?.secrets) ? body.secrets : [])
          return true
        } catch {
          setError('无法连接到服务端。')
          return false
        } finally {
          setBusy(false)
        }
      }

      const secondary = { color: 'var(--dsw-alias-label-tertiary, #81858c)', fontSize: '13px' }
      const field = {
        height: '32px', padding: '0 10px', minWidth: 0,
        border: '1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%))',
        borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, inherit)', font: 'inherit', fontSize: '13px',
      }

      const submit = async (event) => {
        event.preventDefault()
        if (await send('/secrets', { name: name.trim(), value })) {
          setName('')
          setValue('')
        }
      }

      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '40rem' } },
        React.createElement('style', null, BUTTON_CSS),
        // The heading and the two sentences under it are one block, on a gap of
        // their own. They were four siblings of the section's own gap, which is
        // there to separate a heading from a list from a form — and it pushed
        // one explanation apart as though its parts were unrelated.
        React.createElement(
          'div',
          {
            style: {
              display: 'flex', flexDirection: 'column', gap: '4px',
              marginTop: '8px', paddingTop: '20px',
              borderTop: '1px solid var(--dsw-alias-border-l1)',
            },
          },
          React.createElement(
            'div',
            {
              style: {
                marginBottom: '2px', fontSize: '13px', fontWeight: 500,
                color: 'var(--dsw-alias-label-secondary, #4c5157)',
              },
            },
            '环境变量',
          ),
          React.createElement(
            'p',
            { style: { ...secondary, margin: 0, lineHeight: 1.6 } },
            '这些变量会在创建沙箱时注入它的环境。值只写入、不回显——保存后这里只显示名称。',
          ),
          // Said plainly rather than discovered: an environment is fixed when a
          // process starts, so a value added now reaches the next sandbox and
          // not the one already running.
          React.createElement(
            'p',
            { style: { ...secondary, margin: 0, lineHeight: 1.6 } },
            '改动对当前沙箱不生效，会在它被回收、下次重新创建时生效。',
          ),
        ),
        // Nothing at all when there is nothing to list. The form below is the
        // whole of what an empty state has to offer, and a line saying the list
        // is empty above an empty list says it twice.
        list === null || list.length === 0
          ? null
          : React.createElement(
              'div',
              { style: { display: 'flex', flexDirection: 'column' } },
              ...list.map((entry) => React.createElement(
                'div',
                {
                  key: entry.name,
                  style: {
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0',
                    borderBottom: '1px solid var(--dsw-alias-border-l1)',
                  },
                },
                React.createElement(
                  'code',
                  {
                    style: {
                      flex: '1 1 auto', minWidth: 0, fontSize: '13px',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    },
                  },
                  entry.name,
                ),
                React.createElement('span', { style: secondary }, '已设置'),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: BUTTON_CLASS,
                    style: { height: '28px', padding: '0 10px', fontSize: '12px' },
                    disabled: busy,
                    onClick: () => { void send('/secrets/delete', { name: entry.name }) },
                  },
                  '删除',
                ),
              )),
            ),
        React.createElement(
          'form',
          { onSubmit: submit, style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          React.createElement('input', {
            value: name,
            onChange: (event) => setName(event.target.value),
            placeholder: 'NAME',
            spellCheck: false,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            style: { ...field, flex: '0 0 12rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          }),
          React.createElement('input', {
            value,
            onChange: (event) => setValue(event.target.value),
            placeholder: '值',
            // The one control that holds a secret while it is being typed.
            type: 'password',
            autoComplete: 'new-password',
            style: { ...field, flex: '1 1 auto' },
          }),
          React.createElement(
            'button',
            { type: 'submit', className: BUTTON_CLASS, disabled: busy || name.trim() === '' },
            '保存',
          ),
        ),
        error === '' ? null : React.createElement(
          'p',
          { style: { ...secondary, margin: 0, color: 'var(--dsw-alias-state-error-primary, #ec1313)' } },
          error,
        ),
      )
    }

    /**
     * The seat `dsh-sandbox-host` leaves at the foot of its sandbox page.
     *
     * Named rather than reached through a slot: the settings shell's slot
     * ledger is an unversioned harness surface, and a class on an element that
     * plugin scopes to itself is the same contract with none of that risk. It
     * is also how that plugin already hangs its own surfaces off the shell.
     */
    const SANDBOX_PAGE_SEAT = 'dsh-sandbox-host-page-extra'

    /**
     * Put the environment editor inside the sandbox page rather than beside it.
     *
     * Two settings pages for one machine was one too many — what a tenant sets
     * and what the machine is doing are the same subject — but the two halves
     * cannot live in one package: the figures survive the gateway's removal and
     * the variables do not. So the page comes from there, the editor from here,
     * and a portal joins them.
     *
     * The seat appears and disappears with the settings panel, so it is watched
     * rather than looked up once. Mounted from the sidebar row, which is the
     * one thing this plugin always has on screen.
     *
     * @returns {object | null} the portal, or nothing while the page is closed.
     */
    const SecretsInSandboxPage = () => React.createElement(
      React.Fragment,
      null,
      React.createElement(InSeat, { seat: SANDBOX_PAGE_SEAT },
        React.createElement(SecretsSection)),
      React.createElement(InSeat, { seat: SANDBOX_STATUS_SEAT },
        React.createElement(RestartControl)),
    )

    /** The seat beside the sandbox page's status line. */
    const SANDBOX_STATUS_SEAT = 'dsh-sandbox-host-status-extra'

    /**
     * Throw this tenant's machine away and reload onto the new one.
     *
     * The gateway does not restart anything — it forgets the sandbox and
     * removes it, and the next request builds a fresh one. That is already how
     * idle reclamation works, so this asks the deployment for nothing it does
     * not already survive.
     *
     * Two presses rather than a dialog. Ending a sandbox interrupts whatever
     * the agent was doing, which is worth a deliberate second gesture, and a
     * confirm() would block the page on a decision about the page.
     *
     * @returns {object} the control.
     */
    const RestartControl = () => {
      const [asking, setAsking] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')

      // A question nobody answers should not stay asked.
      React.useEffect(() => {
        if (!asking) return undefined
        const timer = setTimeout(() => { setAsking(false) }, 5000)
        return () => { clearTimeout(timer) }
      }, [asking])

      const restart = async () => {
        setBusy(true)
        setError('')
        try {
          const response = await fetch('/sandbox/restart', { method: 'POST', credentials: 'same-origin' })
          if (!response.ok) {
            const body = await response.json().catch(() => ({}))
            setError(String(body?.error ?? '重启失败。'))
            setBusy(false)
            setAsking(false)
            return
          }
        } catch {
          setError('无法连接到服务端。')
          setBusy(false)
          setAsking(false)
          return
        }
        // Reloaded rather than left to recover. The frontend holds an event
        // socket to a backend that has just been removed, and the shortest
        // honest path to a working page is to ask for it again — which is also
        // what builds the replacement sandbox.
        globalThis.location.reload()
      }

      return React.createElement(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
        error === '' ? null : React.createElement(
          'span',
          { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #ec1313)' } },
          error,
        ),
        React.createElement('style', null, BUTTON_CSS),
        React.createElement(
          'button',
          {
            type: 'button',
            className: BUTTON_CLASS,
            style: { height: '28px', padding: '0 12px', fontSize: '12px' },
            disabled: busy,
            'data-danger': asking ? 'true' : undefined,
            onClick: () => { if (asking) { void restart() } else { setAsking(true) } },
          },
          busy ? '正在重启…' : asking ? '确认重启？' : '重启',
        ),
      )
    }

    /**
     * Put a control into a seat another plugin left, once that seat exists.
     *
     * The settings panel mounts and unmounts its pages as they are chosen, so
     * the seat is watched rather than looked up once.
     *
     * @param {object} props - `seat` class name and the `children` to portal in.
     * @returns {object | null} the portal, or nothing while the seat is absent.
     */
    const InSeat = ({ seat, children }) => {
      const [node, setNode] = React.useState(null)

      React.useEffect(() => {
        const find = () => { setNode(document.querySelector(`.${seat}`)) }
        find()
        const observer = new MutationObserver(find)
        observer.observe(document.body, { childList: true, subtree: true })
        return () => { observer.disconnect() }
      }, [seat])

      if (node === null) return null
      return ReactDom.createPortal(children, node)
    }

    /** The size an avatar is stored at, matching what the sign-up page sends. */
    const AVATAR_EDGE = 256

    /**
     * Turn a chosen image into what the gateway will store.
     *
     * Drawn through a canvas rather than sent as picked: the column holds a
     * `data:` URI and is read whole on every `/whoami`, so a phone photograph
     * would be megabytes on every page load. Square-cropped from the centre,
     * which is how it will be displayed anyway.
     *
     * WebP, because that is what the sign-up page's cropper sends and what the
     * gateway's allowed-types pattern is written around.
     *
     * @param {File} file - what was chosen.
     * @returns {Promise<string>} a `data:` URI.
     */
    const asAvatar = async (file) => {
      const bitmap = await createImageBitmap(file)
      const edge = Math.min(bitmap.width, bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = AVATAR_EDGE
      canvas.height = AVATAR_EDGE
      const context = canvas.getContext('2d')
      context.drawImage(
        bitmap,
        (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge,
        0, 0, AVATAR_EDGE, AVATAR_EDGE,
      )
      bitmap.close()
      return canvas.toDataURL('image/webp', 0.85)
    }

    /**
     * Editing the profile, without leaving the page.
     *
     * It used to be a link to `/profile`, which is a real page the gateway
     * serves and has to keep: an account arrives at it before it has ever
     * loaded this bundle, on the way in. But following it from inside the
     * application throws the whole shell away and rebuilds it, for a change of
     * two fields — the session's scroll position, the open panel, an unsent
     * draft, all of it.
     *
     * So the same handler answers both. This posts the same form to the same
     * route with `Accept: application/json`, which means every rule about what
     * a name and an avatar may be is enforced in one place rather than
     * restated here.
     *
     * @param {object} props - the current values, and how to close.
     * @returns {object} the element.
     */
    const ProfileDialog = ({ who, onClose }) => {
      const [name, setName] = React.useState(who.displayName)
      const [avatar, setAvatar] = React.useState(who.avatar)
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(undefined)
      const field = React.useRef(null)
      const picker = React.useRef(null)

      React.useEffect(() => {
        window.setTimeout(() => field.current?.focus(), 0)
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey) }
      }, [onClose])

      const save = async () => {
        setBusy(true)
        setFailed(undefined)
        const form = new URLSearchParams()
        form.set('name', name)
        // Three states, as the handler expects: leave it, replace it, remove
        // it. An empty field cannot mean both of the last two.
        if (avatar === '') form.set('avatar_clear', '1')
        else if (avatar !== who.avatar) form.set('avatar', avatar)
        try {
          const response = await fetch('/profile', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: form.toString(),
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) {
            setFailed(payload.error ?? `保存失败（${String(response.status)}）`)
            setBusy(false)
            return
          }
          refreshWhoami()
          onClose()
        } catch {
          setFailed('保存失败，请稍后再试。')
          setBusy(false)
        }
      }

      const initial = initialOf(name === '' ? who.username : name)

      return ReactDom.createPortal(
        React.createElement(
          'div',
          {
            className: `${U}-mask`,
            // Its own boundary, for the same reason the menu has one: this is
            // a second portal, and closing the menu that opened it took it out
            // of that portal's subtree. Without this, pressing 确定 propagated
            // up the component tree to the settings trigger and the settings
            // panel appeared on top of the profile that had just been saved.
            onClick: (event) => { event.stopPropagation() },
            onPointerDown: (event) => {
              event.stopPropagation()
              if (event.target === event.currentTarget) onClose()
            },
          },
          React.createElement('style', null, DIALOG_CSS),
          React.createElement(
            'div',
            { className: `${U}-dialog`, role: 'dialog', 'aria-modal': 'true', 'aria-label': '修改个人资料' },
            React.createElement('div', { className: `${U}-dialog-title` }, '个人资料'),
            React.createElement(
              'div',
              { className: `${U}-dialog-row` },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: `${U}-dialog-avatar`,
                  title: '更换头像',
                  onClick: () => picker.current?.click(),
                },
                avatar === ''
                  ? initial
                  : React.createElement('img', { src: avatar, alt: '' }),
              ),
              React.createElement('input', {
                ref: picker,
                type: 'file',
                accept: 'image/png,image/jpeg,image/webp',
                style: { display: 'none' },
                onChange: (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file === undefined) return
                  asAvatar(file).then(setAvatar, () => setFailed('这张图片读不出来，请换一张。'))
                },
              }),
              React.createElement(
                'div',
                { className: `${U}-dialog-avatar-actions` },
                React.createElement('button', {
                  type: 'button', className: `${U}-dialog-link`, onClick: () => picker.current?.click(),
                }, '更换头像'),
                avatar === '' ? null : React.createElement('button', {
                  type: 'button', className: `${U}-dialog-link`, onClick: () => setAvatar(''),
                }, '移除'),
              ),
            ),
            React.createElement('input', {
              ref: field,
              className: `${U}-dialog-input`,
              value: name,
              placeholder: '昵称',
              'aria-label': '昵称',
              onChange: (event) => setName(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter' && !busy) void save() },
            }),
            failed === undefined ? null : React.createElement('div', { className: `${U}-dialog-note` }, failed),
            React.createElement(
              'div',
              { className: `${U}-dialog-actions` },
              React.createElement('button', {
                type: 'button', className: `${U}-dialog-button`, onClick: onClose,
              }, '取消'),
              React.createElement('button', {
                type: 'button', className: `${U}-dialog-button`, 'data-primary': '', disabled: busy,
                onClick: () => { void save() },
              }, busy ? '保存中…' : '保存'),
            ),
          ),
        ),
        document.body,
      )
    }

    /** The account page: who is signed in, and how to stop being signed in. */
    const AccountSection = () => {
      const who = useWhoami()
      const { username, admin, displayName, avatar } = who
      const [editing, setEditing] = React.useState(false)

      const row = { display: 'flex', alignItems: 'baseline', gap: '12px', padding: '10px 0' }
      const key = { minWidth: '5rem', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' }

      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '32rem' } },
        // The profile, and the one way to change it. `/profile` is a gateway
        // page rather than a panel here for the same reason `/admin` is a link:
        // it edits an account the harness has no notion of, and it has to work
        // on the way in, before this bundle has ever loaded.
        React.createElement(
          'div',
          { style: { ...row, alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
          React.createElement('span', { style: key }, '昵称'),
          React.createElement(
            'span',
            {
              style: {
                flex: 'none', width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--dsw-alias-border-l1, rgb(0 0 0 / 4%))',
                fontSize: '13px', fontWeight: 600, textTransform: 'uppercase',
              },
            },
            avatar === ''
              ? initialOf(displayName === '' ? username : displayName)
              : React.createElement('img', {
                src: avatar,
                alt: '',
                style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
              }),
          ),
          React.createElement(
            'span',
            { style: { flex: '1 1 auto', minWidth: 0, fontSize: '14px', color: 'var(--dsw-alias-label-primary)' } },
            displayName === '' ? '—' : displayName,
          ),
          // A button, not a link. `/profile` is still a real page and still
          // has to be — an account meets it on the way in, before this bundle
          // exists — but reaching it from inside the application would throw
          // the whole shell away and rebuild it to change two fields.
          React.createElement(
            'button',
            {
              type: 'button',
              style: {
                padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: '13px', fontFamily: 'var(--dsw-font-family)',
                color: 'var(--dsw-alias-state-business-primary)',
              },
              onClick: () => setEditing(true),
            },
            '修改',
          ),
        ),
        React.createElement(
          'div',
          { style: { ...row, borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
          React.createElement('span', { style: key }, '当前用户'),
          React.createElement('span', { style: { fontSize: '14px', color: 'var(--dsw-alias-label-primary)' } }, username === '' ? '—' : username),
        ),
        editing ? React.createElement(ProfileDialog, { who, onClose: () => setEditing(false) }) : null,
        // The only way in to the console, and the reason it is here: `/admin`
        // answers 404 to everyone else, so it is not linked anywhere a tenant
        // could find it — which left an administrator having to remember the
        // path. Rendered from `/whoami`'s answer rather than by trying the page,
        // so a tenant's browser never asks for it at all.
        admin && React.createElement(
          'div',
          { style: { ...row, borderBottom: '1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%))' } },
          React.createElement('span', { style: key }, '管理'),
          React.createElement(
            'a',
            { href: '/admin', style: { fontSize: '14px', color: 'inherit' } },
            '用户管理',
          ),
        ),
        React.createElement(
          'div',
          { style: { paddingTop: '18px' } },
          // A stylesheet rather than inline styles, because the hover state is
          // half of what makes this look like the shell's own control and there
          // is no inline form of it. One rule, scoped to a class nothing else
          // uses.
          React.createElement('style', null, BUTTON_CSS),
          React.createElement(
            'button',
            // The same act as the one in the sidebar menu, so the same colour:
            // the variant already exists on this class and was simply not asked
            // for here, which left the page's only destructive control looking
            // like every other button on it.
            { type: 'button', onClick: signOut, className: BUTTON_CLASS, 'data-danger': 'true' },
            React.createElement('svg', {
              width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
            }, React.createElement('path', {
              d: 'M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6M10.5 11 14 8l-3.5-3M14 8H6',
              stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
            })),
            '退出登录',
          ),
          React.createElement(
            'p',
            {
              style: {
                margin: '10px 0 0', fontSize: '12px',
                color: 'var(--dsw-alias-label-secondary)',
              },
            },
            '退出后当前会话立即失效，你的沙箱会被释放。',
          ),
        ),
      )
    }

    /** Classes the rules below are scoped to; nothing else in the page uses them. */
    const U = 'dsh-tenant-account'

    /**
     * The dialog's styles.
     *
     * Token-driven like everything else here, and injected with the dialog
     * rather than with the sidebar row, because nothing else in this plugin
     * needs them until somebody edits their profile.
     * (No backticks in this file's CSS: it is a template literal.)
     */
    const DIALOG_CSS = `
      .${U}-mask {
        /* Above the settings panel's own 1000: this dialog is opened FROM that
           panel, so a lower layer would put it behind the thing that asked for
           it. */
        position: fixed; inset: 0; z-index: 1100;
        display: flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-bg-mask-1);
      }
      .${U}-dialog {
        width: min(360px, calc(100vw - 32px));
        padding: 18px 20px 14px;
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: var(--dsw-shadow-lv3);
        font-family: var(--dsw-font-family);
      }
      .${U}-dialog-title {
        margin-bottom: 14px;
        color: var(--dsw-alias-label-primary);
        font-size: 15px; font-weight: 500;
      }
      .${U}-dialog-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .${U}-dialog-avatar {
        flex: none; width: 56px; height: 56px; padding: 0;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%;
        overflow: hidden; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-button-ghost-active-fill);
        color: var(--dsw-alias-label-secondary);
        font-family: var(--dsw-font-family); font-size: 18px; font-weight: 600; text-transform: uppercase;
      }
      .${U}-dialog-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .${U}-dialog-avatar-actions { display: flex; gap: 10px; }
      .${U}-dialog-link {
        padding: 0; border: none; background: transparent;
        color: var(--dsw-alias-state-business-primary);
        font-family: var(--dsw-font-family); font-size: 13px; cursor: pointer;
      }
      .${U}-dialog-input {
        width: 100%; height: 34px; padding: 0 10px; box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
        background: transparent; color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family); font-size: 13px;
      }
      .${U}-dialog-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
      .${U}-dialog-note {
        margin-top: 8px; color: var(--dsw-alias-state-error-primary);
        font-size: 12px; line-height: 18px;
      }
      .${U}-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      .${U}-dialog-button {
        height: 32px; padding: 0 14px;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
        background: transparent; color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family); font-size: 13px; cursor: pointer;
      }
      .${U}-dialog-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .${U}-dialog-button[data-primary] {
        border-color: transparent;
        background: var(--dsw-alias-button-primary-fill);
        color: var(--dsw-alias-label-primary-foreground);
      }
      .${U}-dialog-button:disabled { opacity: .55; cursor: default; }
    `


    /** Restated from the theme's own tokens, like the sign-out button above. */
    const MENU_CSS = `
      .${U}-row {
        display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
      }
      .${U}-row[data-wide='false'] { justify-content: center; gap: 0; }
      /* Two lines, as the trigger carries two facts: who is signed in, and what
          they are on. Column rather than a second row so the avatar stays
          vertically centred against both. */
      .${U}-who {
        flex: 1 1 auto; min-width: 0;
        display: flex; flex-direction: column; gap: 1px; text-align: left;
      }
      .${U}-name {
        overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
        font-size: 14px; line-height: 18px;
        color: var(--dsw-alias-label-primary, inherit);
      }
      .${U}-plan {
        overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
        font-size: 12px; line-height: 16px;
        color: var(--dsw-alias-label-tertiary, #81858c);
      }
      /* Points at the menu: up while it is shut and the menu is above, down
          once it is open. It is the only affordance saying this row opens
          anything, which is what it was missing. */
      .${U}-chev {
        flex: none; display: block;
        color: var(--dsw-alias-label-tertiary, #81858c);
        transition: transform .15s ease;
      }
      .${U}-row[data-open='true'] .${U}-chev { transform: rotate(180deg); }
      .${U}-avatar {
        flex: none; width: 26px; height: 26px; border-radius: 50%;
        /* Clips the picture to the circle the letter already sat in. */
        overflow: hidden;
        display: inline-flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-border-l1, rgb(0 0 0 / 4%));
        color: var(--dsw-alias-label-primary, inherit);
        font-size: 11px; font-weight: 600; text-transform: uppercase;
      }
      /* Cover, not contain: the crop was already chosen on the profile page and
          the image is square, so this only absorbs the rounding. */
      .${U}-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
      /* Portalled onto the document body rather than left where it is written.
          It was a child of the shell's Settings *button*, and everything that
          implies went wrong one at a time: it inherited the button's centred
          text, its links were boxed differently from its buttons, hovering a
          row lit the sidebar seat underneath it, and a capture listener on the
          button swallowed every click meant for a menu item. Being fixed-
          positioned already, it never needed to live there.
          (No backticks in this file's CSS: it is a template literal.) */
      .${U}-menu {
        position: fixed; z-index: 200; min-width: 232px; box-sizing: border-box; padding: 4px;
        text-align: left;
        border: 1px solid transparent;
        border-radius: 12px;
        background: var(--dsw-alias-button-elevated-fill, #fff);
        /* The shell's own popup elevation, by its name rather than by its
           three layers copied out. They were transcribed here once, correctly,
           and a correct copy is still a copy: it cannot follow the token when
           the palette moves under it. */
        box-shadow: var(--dsw-shadow-lv3);
      }
      /* The menu's own header: the same avatar the trigger shows, at the size
          a popup can afford, over the same two facts. Repeating them is what
          makes the menu feel anchored to the row it came out of. */
      .${U}-card { display: flex; align-items: center; gap: 10px; padding: 10px 10px 12px; }
      .${U}-card .${U}-avatar { width: 36px; height: 36px; font-size: 14px; }
      .${U}-sep {
        height: 1px; margin: 4px 6px;
        background: var(--dsw-alias-border-l1, rgb(0 0 0 / 6%));
      }
      /* A section's caption, not a row: the address is shown, never actioned. */
      .${U}-label {
        padding: 6px 10px; font-size: 12px; line-height: 16px;
        color: var(--dsw-alias-label-tertiary, #81858c);
        overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
      }
      .${U}-item {
        display: flex; align-items: center; gap: 8px; width: 100%;
        /* Stated, not inherited: half these rows are buttons, which browsers
            already box as border-box, and half are anchors, which they do not —
            so one width of 100% plus the same padding overflowed the menu by
            those 20px on the links alone. */
        box-sizing: border-box;
        padding: 8px 10px; border: none; border-radius: 10px;
        background: transparent; color: var(--dsw-alias-label-primary, inherit);
        font-family: inherit; font-size: 14px; line-height: 22px;
        text-align: left; text-decoration: none; cursor: pointer;
      }
      /* An overlay, not a fill. The obvious token for a hovered row,
          button-ghost-active-fill, resolves to the same colour as
          button-elevated-fill in dark — which is this menu's own background, so
          hovering did nothing there while looking correct in light. This one is
          the translucent wash the shell uses for its own hoverable rows, and it
          reads on whatever it is laid over.
          (No backticks anywhere in this file's CSS: it is a template literal.) */
      .${U}-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%)); }
      .${U}-item[data-danger='true'] { color: var(--dsw-alias-state-error-primary, #ec1313); }
      /* The shell tints a destructive row's hover rather than greying it. */
      .${U}-item[data-danger='true']:hover {
        background: var(--dsw-alias-interactive-bg-hover-danger, rgb(236 19 19 / 5%));
      }
    `

    /**
     * The tenant, at the sidebar's foot, with everything about them behind it.
     *
     * This takes the `settings.trigger` seat rather than adding a row beside
     * it, because the shell's Settings control IS that seat: the owner wraps
     * whatever fills it in the button that opens the panel. Filling it with the
     * account row is what demotes Settings from a first-class control to one
     * line in this menu — which is the whole point — and it leaves the panel
     * itself, and every section in it, untouched.
     *
     * Opening the panel from the menu clicks that owner button directly. There
     * is no programmatic way in: `open` is local state inside the settings
     * shell, with no service and no event to reach it. The click is the seam
     * the shell already has.
     *
     * @param {object} props - the sidebar's owner share (`wide`).
     * @returns {object} the row, and the menu while it is open.
     */
    /**
     * A chevron, pointing at the menu this row opens.
     * @param {object} props - `size` in pixels.
     * @returns {object} the icon.
     */
    const Chevron = ({ size = 14 }) => React.createElement(
      'svg',
      {
        className: `${U}-chev`, width: size, height: size,
        viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
      React.createElement('path', {
        d: 'M4 10l4-4 4 4',
        stroke: 'currentColor', strokeWidth: 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
    )

    /**
     * One 16px glyph, by name. Inline because the shell exports no icon set and
     * four paths are cheaper than a dependency that would have to be bundled.
     *
     * @param {object} props - `name`, one of the keys below.
     * @returns {object | null} the icon, or null for an unknown name.
     */
    const Icon = ({ name }) => {
      const paths = {
        settings: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM13.3 9.5l1.2.7-1.5 2.6-1.3-.6a5.5 5.5 0 0 1-1.2.7L10.3 14h-3l-.2-1.4a5.5 5.5 0 0 1-1.2-.7l-1.3.6-1.5-2.6 1.2-.7a5.6 5.6 0 0 1 0-1.4l-1.2-.7 1.5-2.6 1.3.6a5.5 5.5 0 0 1 1.2-.7L7.3 2h3l.2 1.4c.4.2.8.4 1.2.7l1.3-.6 1.5 2.6-1.2.7a5.6 5.6 0 0 1 0 1.4z',
        profile: 'M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8zM2.75 14a5.25 5.25 0 0 1 10.5 0',
        admin: 'M8 1.75 13 4v4c0 3-2.1 5.4-5 6.25C5.1 13.4 3 11 3 8V4z',
        signout: 'M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6M10.5 11 14 8l-3.5-3M14 8H6',
      }
      const d = paths[name]
      if (d === undefined) return null
      return React.createElement('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
        style: { flex: 'none' }, 'aria-hidden': true,
      }, React.createElement('path', {
        d, stroke: 'currentColor', strokeWidth: 1.3,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /**
     * The tenant, at the sidebar's foot, with everything about them behind it.
     *
     * This takes the `settings.trigger` seat rather than adding a row beside
     * it, because the shell's Settings control IS that seat: the owner wraps
     * whatever fills it in the button that opens the panel. Filling it with the
     * account row is what demotes Settings from a first-class control to one
     * line in this menu — which is the whole point — and it leaves the panel
     * itself, and every section in it, untouched.
     *
     * Opening the panel from the menu clicks that owner button directly. There
     * is no programmatic way in: `open` is local state inside the settings
     * shell, with no service and no event to reach it. The click is the seam
     * the shell already has.
     *
     * @param {object} props - the sidebar's owner share (`wide`).
     * @returns {object} the row, and the menu while it is open.
     */
    const AccountRow = ({ wide }) => {
      const who = useWhoami()
      const [menu, setMenu] = React.useState(null)
      const [editing, setEditing] = React.useState(false)
      const host = React.useRef(null)
      // Raised only while this component clicks the owner's button on purpose,
      // so the interceptor below lets that one click through to the shell.
      const passing = React.useRef(false)

      /**
       * Open the menu, or shut it.
       *
       * Measured from the BUTTON, not from this row: the row sits inside the
       * owner's padding, and a menu aligned to it hangs a few pixels into the
       * sidebar's edge.
       */
      const toggle = React.useCallback(() => {
        const rect = host.current?.closest('button')?.getBoundingClientRect()
        setMenu((open) => (open !== null || rect === undefined
          ? null
          // On the rail the button is 40-odd pixels wide and a menu aligned to
          // its left edge would hang off the column; there, it opens beside the
          // rail instead of above it.
          : {
            left: wide === true ? rect.left : rect.right + 8,
            bottom: wide === true ? window.innerHeight - rect.top + 6 : window.innerHeight - rect.bottom,
            // Take the trigger's width, not a minimum of our own. Aligning
            // only the left edge left the menu 10px from the column's left and
            // 28px from its right — lopsided, and the more so beside the
            // sandbox row above it, which sits 12px in on both sides. Matching
            // the row it came out of is also the only version that survives
            // the sidebar being dragged wider.
            width: wide === true ? rect.width : undefined,
          }))
      }, [wide])

      /**
       * Open the shell's settings panel through the button this sits inside.
       *
       * Declared before the effects that use it, and memoised, because one of
       * them subscribes to the document and would otherwise re-subscribe on
       * every render.
       */
      const openSettings = React.useCallback(() => {
        setMenu(null)
        const button = host.current?.closest('button')
        // The interceptor below is on that button and would swallow this too.
        passing.current = true
        button?.click()
        passing.current = false
      }, [])

      // The owner's button opens Settings on click, and this seat is the whole
      // account control now, so that gesture belongs to the menu instead.
      //
      // Bound to the BUTTON rather than to this row, which is the fix for a
      // click landing on the button's own padding — a few pixels of it show
      // around the row, and a press there missed the row's handler entirely and
      // opened Settings, which is exactly what this seat exists to prevent.
      React.useEffect(() => {
        const button = host.current?.closest('button')
        if (button === null || button === undefined) return undefined
        const intercept = (event) => {
          if (passing.current) return
          event.stopPropagation()
          event.preventDefault()
          toggle()
        }
        button.addEventListener('click', intercept, true)
        return () => { button.removeEventListener('click', intercept, true) }
      }, [toggle])

      // The sandbox row above this one opens the settings panel.
      //
      // The panel, not this menu: the row is about the machine, and what a
      // person wants after pressing it is the pages that describe and configure
      // it — this menu is about the account, and answers a different question.
      // It restores the gesture the shell's own Settings control had before
      // this seat took it over.
      //
      // Reached through the document rather than through the element, because
      // that row belongs to `dsh-sandbox-host` and mounts, unmounts and remounts
      // on its own — it is absent on the narrow rail. The knowledge runs one
      // way only: this plugin knows that row exists, and that one still works
      // with no gateway and nothing listening behind it.
      React.useEffect(() => {
        const open = (event) => {
          if (!event.target?.closest?.(`.${SANDBOX_ROW}`)) return
          event.stopPropagation()
          openSettings()
        }
        document.addEventListener('click', open, true)
        return () => { document.removeEventListener('click', open, true) }
      }, [openSettings])

      // Dismissed the way every menu is: a pointer somewhere else, or Escape.
      React.useEffect(() => {
        if (menu === null) return undefined
        const away = (event) => {
          const target = event.target
          if (target?.closest?.(`.${U}-menu`)) return
          // The seat that toggles this menu answers for itself. Closing on its
          // pointerdown would let the click that follows reopen what it was
          // meant to shut, and it could never be closed by pressing it again.
          //
          // The sandbox row is not exempt: it opens the settings panel, so a
          // press there should take this menu down like any other press away.
          if (host.current !== null && target?.closest?.('button') === host.current.closest('button')) return
          setMenu(null)
        }
        const key = (event) => { if (event.key === 'Escape') setMenu(null) }
        document.addEventListener('pointerdown', away, true)
        document.addEventListener('keydown', key)
        return () => {
          document.removeEventListener('pointerdown', away, true)
          document.removeEventListener('keydown', key)
        }
      }, [menu !== null])

      // What they asked to be called, falling back to the address they signed in
      // with — an account from before this deployment asked has no name, and so
      // does one whose answer has not arrived yet.
      const named = who.displayName === '' ? who.username : who.displayName
      const label = named === '' ? '—' : named
      // The name's first letter, which is the only part of it that fits on the
      // 56px rail, and what stands in until a picture is set. A question mark
      // while it loads would be a different claim — that nobody is signed in —
      // so an empty circle waits instead.
      const avatar = React.createElement(
        'span',
        { className: `${U}-avatar` },
        who.avatar === ''
          ? initialOf(named)
          : React.createElement('img', { src: who.avatar, alt: '' }),
      )

      return React.createElement(
        'div',
        {
          ref: host,
          className: `${U}-row`,
          'data-wide': String(wide === true),
          'data-open': String(menu !== null),
        },
        // The nav rule rides along with the menu's: this row is mounted for as
        // long as the sidebar is, which is longer than the settings panel it
        // applies to.
        React.createElement('style', null, `${MENU_CSS}\n${NAV_GLYPH_CSS}`),
        // Not part of this row; it just needs an always-mounted host, and this
        // seat is the only one this plugin holds unconditionally.
        React.createElement(SecretsInSandboxPage, {}),
        avatar,
        wide && React.createElement(
          'span',
          { className: `${U}-who` },
          React.createElement('span', { className: `${U}-name`, title: label }, label),
          React.createElement('span', { className: `${U}-plan` }, PLAN_LABEL),
        ),
        wide && React.createElement(Chevron, {}),
        menu !== null && ReactDom.createPortal(React.createElement(
          'div',
          {
            className: `${U}-menu`,
            style: {
              left: `${String(menu.left)}px`,
              bottom: `${String(menu.bottom)}px`,
              ...(menu.width === undefined ? {} : { width: `${String(menu.width)}px` }),
            },
            role: 'menu',
            // Contained here, at the root, and it has to be contained in
            // REACT's terms rather than the DOM's.
            //
            // This menu is portalled to `document.body`, so the DOM path of a
            // click in it is body -> html and never touches the settings
            // trigger this seat is rendered inside. React does not care: a
            // portal propagates through the COMPONENT tree, so that trigger's
            // own onClick fired anyway and the settings panel opened behind the
            // menu. The native capture listener on the button cannot help — the
            // event never travels through it.
            //
            // It was stopped row by row before, which held only as long as
            // nobody added a row. The admin link never had it and always
            // opened settings on its way to /admin, and the dialog this menu
            // opens had it nowhere, so saving a profile opened settings too.
            // One boundary, at the edge of what is portalled, is the version
            // that stays fixed.
            onClick: (event) => { event.stopPropagation() },
            onPointerDown: (event) => { event.stopPropagation() },
          },
          React.createElement(
            'div',
            { className: `${U}-card` },
            React.createElement(
              'span',
              { className: `${U}-avatar` },
              who.avatar === ''
                ? initialOf(named)
                : React.createElement('img', { src: who.avatar, alt: '' }),
            ),
            React.createElement(
              'span',
              { className: `${U}-who` },
              React.createElement('span', { className: `${U}-name`, title: label }, label),
              React.createElement('span', { className: `${U}-plan` }, PLAN_LABEL),
            ),
          ),
          React.createElement('div', { className: `${U}-sep` }),
          // The address, shown and not actioned: it is what the account IS, and
          // there is nothing to do to it from here.
          React.createElement(
            'div',
            { className: `${U}-label`, title: who.username },
            who.username === '' ? '—' : who.username,
          ),
          React.createElement('div', { className: `${U}-sep` }),
          React.createElement(
            'button',
            { type: 'button', role: 'menuitem', className: `${U}-item`, onClick: openSettings },
            React.createElement(Icon, { name: 'settings' }),
            '设置',
          ),
          // The same dialog the account page opens, for the same reason: the
          // page it used to link to rebuilds the whole shell.
          React.createElement(
            'button',
            {
              type: 'button', role: 'menuitem', className: `${U}-item`,
              onClick: () => { setMenu(null); setEditing(true) },
            },
            React.createElement(Icon, { name: 'profile' }),
            '个人资料',
          ),
          // Only the console's own audience is told it exists: `/admin` answers
          // 404 to everyone else, so a link nobody may follow would be a dead
          // end rather than a discovery.
          who.admin && React.createElement(
            'a',
            { role: 'menuitem', className: `${U}-item`, href: '/admin' },
            React.createElement(Icon, { name: 'admin' }),
            '用户管理',
          ),
          React.createElement('div', { className: `${U}-sep` }),
          React.createElement(
            'button',
            {
              type: 'button', role: 'menuitem', className: `${U}-item`, 'data-danger': 'true',
              onClick: () => { setMenu(null); void signOut() },
            },
            React.createElement(Icon, { name: 'signout' }),
            '退出登录',
          ),
        ), document.body),
        editing ? React.createElement(ProfileDialog, { who, onClose: () => setEditing(false) }) : null,
      )
    }

    return {
      inject: ['slots'],
      /**
       * Register the account section.
       * @param {object} ctx - client root context.
       */
      apply(ctx) {
        ctx.effect(
          () => ctx.slots.inject('settings.section', () => ctx.slots.register(
            {
              name: 'settings.section',
              id: 'account',
              order: 900,
              label: navLabel('M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8zM2.75 14a5.25 5.25 0 0 1 10.5 0', '账户'),
            },
            AccountSection,
          )),
          'tenant-account: settings account section',
        )



        // The account row takes the Settings control's seat; see AccountRow.
        // `priority`, not `order`: order is nav position within a cell, while
        // priority is the cell's shadowing rank — ascending, lowest renders.
        ctx.effect(
          () => ctx.slots.inject('settings.trigger', () => ctx.slots.register(
            { name: 'settings.trigger', priority: -1 },
            AccountRow,
          )),
          'tenant-account: account row in the settings trigger seat',
        )

        // Retire the onboarding steps.
        //
        // The welcome notice is an internal-testing disclaimer about DSH's pace
        // and the durability of anything written here — which this deployment
        // already states on its sign-in page, before an account exists and on a
        // page nobody can skip. It would otherwise appear on every reload
        // rather than once: the client persists the acknowledgement through the
        // settings API only when it judges the page loopback, and it judges
        // that from the page's own hostname, so a tenant arriving by domain
        // name gets a value in memory that the next reload discards.
        //
        // `Skip`, not `() => null`. The shell advances its onboarding queue only
        // when the mounted step calls `complete()`, so a step that renders
        // nothing and says nothing parks the queue on itself forever — and the
        // queue holds `#root` inert while it runs, which is a blank page nobody
        // can type into. Rendering null is how a step says "not yet"; calling
        // complete is how it says "done with me".
        for (const step of ['welcome-notice', 'deepseek-official']) {
          ctx.effect(
            () => ctx.slots.inject('settings.onboarding', () => ctx.slots.register(
              { name: 'settings.onboarding', id: step, priority: -1 },
              Skip,
            )),
            `tenant-account: retire the ${step} onboarding step`,
          )
        }
      },
    }
  },
})
