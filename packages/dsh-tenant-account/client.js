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

    /** The account page: who is signed in, and how to stop being signed in. */
    const AccountSection = () => {
      const [username, setUsername] = React.useState('')
      const [admin, setAdmin] = React.useState(false)
      React.useEffect(() => {
        let live = true
        void fetch('/whoami', { credentials: 'same-origin' })
          .then((response) => response.json())
          .then((body) => {
            if (!live) return
            setUsername(String(body?.username ?? ''))
            setAdmin(body?.admin === true)
          })
          // An unreadable answer leaves the name blank; the sign-out control
          // below is what this page exists for and does not depend on it.
          .catch(() => {})
        return () => { live = false }
      }, [])

      const row = { display: 'flex', alignItems: 'baseline', gap: '12px', padding: '10px 0' }
      const key = { minWidth: '5rem', color: 'var(--dsh-text-secondary, #6b6b68)', fontSize: '13px' }

      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '32rem' } },
        React.createElement(
          'div',
          { style: { ...row, borderBottom: '1px solid var(--dsh-border, rgb(0 0 0 / 8%))' } },
          React.createElement('span', { style: key }, '当前用户'),
          React.createElement('span', { style: { fontSize: '14px' } }, username === '' ? '—' : username),
        ),
        React.createElement(
          'div',
          { style: { ...row, borderBottom: '1px solid var(--dsh-border, rgb(0 0 0 / 8%))' } },
          React.createElement('span', { style: key }, '沙箱'),
          React.createElement(
            'span',
            { style: { fontSize: '13px', color: 'var(--dsh-text-secondary, #6b6b68)' } },
            '你独享一个沙箱，会话、工作区与文件均不与其他用户共享。',
          ),
        ),
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
            { type: 'button', onClick: signOut, className: BUTTON_CLASS },
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
                color: 'var(--dsh-text-secondary, #6b6b68)',
              },
            },
            '退出后当前会话立即失效，你的沙箱会被释放。',
          ),
        ),
      )
    }

    /** Classes the rules below are scoped to; nothing else in the page uses them. */
    const U = 'dsh-tenant-account'

    /** Restated from the theme's own tokens, like the sign-out button above. */
    const MENU_CSS = `
      .${U}-row {
        display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
      }
      .${U}-avatar {
        flex: none; width: 24px; height: 24px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-fill-secondary, rgb(0 0 0 / 6%));
        color: var(--dsw-alias-label-primary, inherit);
        font-size: 11px; font-weight: 600; text-transform: uppercase;
      }
      .${U}-email {
        flex: 1 1 auto; min-width: 0; overflow: hidden;
        white-space: nowrap; text-overflow: ellipsis;
        font-size: 13px; text-align: left;
        color: var(--dsw-alias-label-primary, inherit);
      }
      .${U}-menu {
        position: fixed; z-index: 200; min-width: 208px; padding: 4px;
        border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 12px;
        background: var(--dsw-alias-button-elevated-fill, #fff);
        box-shadow: rgb(0 0 0 / 20%) 0 0 1px, rgb(0 0 0 / 8%) 0 12px 32px;
      }
      .${U}-head {
        padding: 8px 10px 6px; font-size: 12px;
        color: var(--dsw-alias-label-secondary, #81858c);
        overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
      }
      .${U}-sep { height: 1px; margin: 4px 0; background: var(--dsw-alias-border-l2, rgb(0 0 0 / 8%)); }
      .${U}-item {
        display: flex; align-items: center; gap: 8px; width: 100%;
        padding: 7px 10px; border: none; border-radius: 8px;
        background: transparent; color: var(--dsw-alias-label-primary, inherit);
        font-family: inherit; font-size: 13px; text-align: left; cursor: pointer;
      }
      .${U}-item:hover { background: var(--dsw-alias-fill-secondary, rgb(0 0 0 / 5%)); }
      .${U}-item[data-danger='true'] { color: var(--dsw-alias-label-error, #c0392b); }
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
    const AccountRow = ({ wide }) => {
      const [who, setWho] = React.useState({ username: '', admin: false })
      const [menu, setMenu] = React.useState(null)
      const host = React.useRef(null)

      React.useEffect(() => {
        let live = true
        void fetch('/whoami', { credentials: 'same-origin' })
          .then((response) => response.json())
          .then((body) => {
            if (!live) return
            setWho({ username: String(body?.username ?? ''), admin: body?.admin === true })
          })
          .catch(() => {})
        return () => { live = false }
      }, [])

      // Dismissed the way every menu is: a pointer somewhere else, or Escape.
      React.useEffect(() => {
        if (menu === null) return undefined
        const away = (event) => {
          if (!event.target?.closest?.(`.${U}-menu`)) setMenu(null)
        }
        const key = (event) => { if (event.key === 'Escape') setMenu(null) }
        document.addEventListener('pointerdown', away, true)
        document.addEventListener('keydown', key)
        return () => {
          document.removeEventListener('pointerdown', away, true)
          document.removeEventListener('keydown', key)
        }
      }, [menu !== null])

      /** Open the shell's settings panel through the button this sits inside. */
      const openSettings = () => {
        setMenu(null)
        host.current?.closest('button')?.click()
      }

      const label = who.username === '' ? '—' : who.username
      const initial = who.username === '' ? '?' : [...who.username][0]

      return React.createElement(
        'div',
        {
          ref: host,
          className: `${U}-row`,
          // The owner's button opens Settings on click. This seat is the whole
          // account control now, so that gesture belongs to the menu instead —
          // and capture-phase is what stops the click before the owner sees it.
          onClickCapture: (event) => {
            event.stopPropagation()
            // Measured from the BUTTON, not from this row: the row sits inside
            // the owner's padding, and a menu aligned to it hangs a few pixels
            // into the sidebar's edge.
            const anchor = host.current?.closest('button') ?? host.current
            const rect = anchor?.getBoundingClientRect()
            setMenu(menu === null && rect
              ? { left: rect.left, bottom: window.innerHeight - rect.top + 6 }
              : null)
          },
        },
        React.createElement('style', null, MENU_CSS),
        React.createElement('span', { className: `${U}-avatar` }, initial),
        wide && React.createElement('span', { className: `${U}-email`, title: label }, label),
        menu !== null && React.createElement(
          'div',
          {
            className: `${U}-menu`,
            style: { left: `${String(menu.left)}px`, bottom: `${String(menu.bottom)}px` },
            role: 'menu',
          },
          React.createElement('div', { className: `${U}-head`, title: label }, label),
          React.createElement('div', { className: `${U}-sep` }),
          React.createElement(
            'button',
            { type: 'button', role: 'menuitem', className: `${U}-item`, onClick: openSettings },
            '设置',
          ),
          // Only the console's own audience is told it exists: `/admin` answers
          // 404 to everyone else, so a link nobody may follow would be a dead
          // end rather than a discovery.
          who.admin && React.createElement(
            'a',
            { role: 'menuitem', className: `${U}-item`, href: '/admin' },
            '用户管理',
          ),
          React.createElement('div', { className: `${U}-sep` }),
          React.createElement(
            'button',
            {
              type: 'button', role: 'menuitem', className: `${U}-item`, 'data-danger': 'true',
              onClick: () => { setMenu(null); void signOut() },
            },
            '退出登录',
          ),
        ),
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
            { name: 'settings.section', id: 'account', order: 900, label: '账户' },
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
