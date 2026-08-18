/**
 * The sandbox adaptation layer, browser half.
 *
 * Four surfaces, all of which exist because the backend is not on this machine:
 *
 * - an "附件" group in the trigger menu, so a file has a way in at all;
 * - the same group spliced onto the `+` menu, which cannot host it properly
 *   (see the note on PlusAttachmentGroup);
 * - attachment cards above the composer, bound to the draft the way dsh's own
 *   image rail is bound to it;
 * - a Configuration page in Settings, because the shipped control hands the
 *   settings document to a desktop that is not there — and nothing at all in
 *   the Settings header, where that control used to be.
 *
 * One file, deliberately: the client-module registry serves a plugin's `client`
 * export verbatim — nothing resolves through node_modules and there is no build
 * step — so a second file would be a second module the shell never fetches.
 * `require` here is the shell's own module table, which is where React comes
 * from.
 */

window.__ModuleLoader__.load({
  id: 'dsh-sandbox-host',
  factory: (require) => {
    const React = require('react')
    const ReactDom = require('react-dom')

    // ---------------------------------------------------------------- wire --

    /** The channel the host half owns. One path segment; see its module note. */
    const CHANNEL = '/files'

    /**
     * The plugin context, captured at mount.
     *
     * A module-level holder rather than React context, because two of the three
     * callers are not components: the trigger source's `onPick` runs inside the
     * input pipeline, and the upload chain outlives whatever rendered it.
     */
    let plugin

    /**
     * Read one Blob as base64, without holding a second copy as a JS string of
     * char codes. `btoa(String.fromCharCode(...bytes))` is the obvious spelling
     * and it exceeds the argument limit somewhere around a megabyte, which is a
     * quarter of one chunk.
     * @param {Blob} blob - the slice to encode.
     * @returns {Promise<string>} its base64, without the data-URL prefix.
     */
    const toBase64 = (blob) => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => { reject(reader.error ?? new Error('could not read the file')) }
      reader.onload = () => {
        const result = String(reader.result)
        resolve(result.slice(result.indexOf(',') + 1))
      }
      reader.readAsDataURL(blob)
    })

    /**
     * One call on the file channel, with the envelope's error thrown.
     * @param {string} endpoint - channel-relative endpoint.
     * @param {object} payload - the request payload.
     * @returns {Promise<object>} the value the host returned.
     */
    const call = async (endpoint, payload) => {
      const result = await plugin.connection.rpc.call(CHANNEL, endpoint, payload)
      if (result.ok) return result.value
      throw new Error(result.error.message)
    }

    /**
     * Send one file to the sandbox and return where it landed.
     *
     * Chunks are sequential rather than parallel. The host appends them in
     * arrival order, and the tunnel is one socket anyway — parallelism here
     * would buy nothing and would need sequence numbers to be correct.
     *
     * @param {File} file - the browser's file.
     * @param {(sent: number) => void} onProgress - bytes accepted so far.
     * @returns {Promise<{path: string, name: string, bytes: number}>} the published file.
     */
    const upload = async (file, onProgress) => {
      const { id, chunkBytes } = await call('upload.begin', { name: file.name, size: file.size })
      try {
        for (let offset = 0; offset < file.size; offset += chunkBytes) {
          const data = await toBase64(file.slice(offset, offset + chunkBytes))
          const { received } = await call('upload.chunk', { id, data })
          onProgress(received)
        }
        return await call('upload.commit', { id, sessionId: composer.sessionId })
      } catch (error) {
        // The staging file would age out on its own, but a browser that failed
        // mid-upload is exactly the case where the tenant retries immediately
        // and meets the in-flight limit.
        await call('upload.abort', { id }).catch(() => {})
        throw error
      }
    }

    // -------------------------------------------------------------- picking --

    /**
     * Ask the person for files.
     *
     * A fresh input each time, removed on either outcome. `cancel` is what
     * closes the dialog without choosing; without listening for it, every
     * cancelled pick would leave an element on the page for the life of the
     * session.
     *
     * @returns {Promise<File[]>} what they chose, empty when they cancelled.
     */
    const pickFiles = () => new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.style.display = 'none'
      document.body.append(input)
      const settle = (files) => { input.remove(); resolve(files) }
      input.addEventListener('change', () => { settle([...(input.files ?? [])]) }, { once: true })
      input.addEventListener('cancel', () => { settle([]) }, { once: true })
      input.click()
    })

    // --------------------------------------------------------------- store --

    /**
     * The cards, and the composer they belong to.
     *
     * A store rather than props: uploads are started from three places — the
     * trigger menu, the spliced `+` group, and a drop — and only one of them is
     * a component. `composer` is the live draft face, refreshed by the card row
     * on every render, so the non-component callers can still write a path into
     * the message being composed.
     */
    const createStore = () => {
      const listeners = new Set()
      /** @type {Array<{key: number, name: string, size: number, sent: number, path?: string, error?: string}>} */
      let rows = []
      let nextKey = 1
      const emit = () => { for (const listener of Array.from(listeners)) listener() }
      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        snapshot: () => rows,
        add(file, sessionId) {
          const key = nextKey
          nextKey += 1
          rows = [...rows, { key, sessionId, name: file.name, size: file.size, sent: 0 }]
          emit()
          return key
        },
        update(key, patch) {
          rows = rows.map((row) => (row.key === key ? { ...row, ...patch } : row))
          emit()
        },
        remove(key) {
          rows = rows.filter((row) => row.key !== key)
          emit()
        },
        /**
         * Drop the cards whose file has been handed to a turn.
         *
         * A card is the receipt for an attachment waiting on the next message.
         * The moment that message starts running, the notice has been claimed
         * and the card has nothing left to say — which is what stops it from
         * becoming the permanent upload log it was in the first cut.
         */
        settle() {
          const next = rows.filter((row) => row.path === undefined && row.error === undefined)
          if (next.length === rows.length) return
          rows = next
          emit()
        },
      }
    }

    const store = createStore()

    /** How long a failed upload keeps its card. */
    const FAILURE_LINGER_MS = 8000

    /** Which session the uploads belong to, refreshed by the card row. */
    const composer = { sessionId: undefined }

    /**
     * Tail of the upload chain.
     *
     * One at a time across the whole page: the tunnel is one socket, so
     * concurrent uploads only take turns more expensively.
     */
    let queue = Promise.resolve()

    /**
     * Upload files and let the host tell the agent about each one.
     *
     * Nothing is written into the draft. On a local host the person types a
     * path because the path is theirs to type; here it would be a path they did
     * not write appearing in a box that already shows them a card for the same
     * file. The host injects the notice into the agent's inbox instead, where
     * it rides the next turn and renders as context rather than as words the
     * person appears to have said.
     *
     * @param {Iterable<File>} files - what to send.
     */
    const sendFiles = (files) => {
      for (const file of files) {
        const key = store.add(file, composer.sessionId)
        queue = queue
          .then(() => upload(file, (sent) => { store.update(key, { sent }) }))
          .then((published) => {
            store.update(key, {
              path: published.path,
              name: published.name,
              sent: published.bytes,
              messageId: published.messageId,
            })
          })
          .catch((error) => {
            store.update(key, { error: error.message })
            // A failure has no card lifetime of its own — nothing in the
            // composer refers to it — so it is the one card that times out.
            setTimeout(() => { store.remove(key) }, FAILURE_LINGER_MS)
          })
      }
    }

    /** Open the picker and send whatever comes back. */
    const pickAndSend = () => { void pickFiles().then((files) => { sendFiles(files) }) }

    /**
     * Subscribe a component to the store.
     * @returns {Array<object>} the current rows.
     */
    const useRows = () => {
      const [rows, setRows] = React.useState(store.snapshot)
      React.useEffect(() => store.subscribe(() => { setRows(store.snapshot()) }), [])
      return rows
    }

    // ---------------------------------------------------------------- copy --

    /**
     * Human byte count, for a line nobody should have to decode.
     * @param {number} bytes - the count.
     * @returns {string} e.g. `1.4 MB`.
     */
    const humanBytes = (bytes) => {
      if (bytes < 1024) return `${String(bytes)} B`
      const units = ['KB', 'MB', 'GB']
      let value = bytes / 1024
      let unit = 0
      while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
      return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit]}`
    }

    /** What the menu calls this group, and what the one item in it says. */
    const GROUP = '附件'
    const ITEM = { name: '上传文件…', description: '从这台电脑选择文件，送进你的沙箱' }

    // --------------------------------------------------------------- style --

    /** Classes the rules below are scoped to; nothing else in the page uses them. */
    const P = 'dsh-sandbox-host'

    /**
     * Restated from the shell's own tokens rather than borrowed from it. Every
     * class a shipped control carries is a content-hashed CSS-module name
     * private to its bundle, but the tokens those names are built from are
     * declared on `body` by the theme — so building from the tokens tracks both
     * themes without this file knowing either.
     */
    const STYLE = `
      .${P}-cards { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 14px 0; }
      .${P}-card {
        display: inline-flex;
        align-items: center;
        max-width: 16rem;
        gap: 8px;
        padding: 6px 10px;
        border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 10px;
        background: var(--dsw-alias-fill-secondary, rgb(0 0 0 / 3%));
        font-size: 13px;
        line-height: 18px;
      }
      .${P}-icon { flex: none; color: var(--dsw-alias-label-secondary, #81858c); }
      .${P}-text { flex: 0 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .${P}-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .${P}-meta { color: var(--dsw-alias-label-secondary, #81858c); font-size: 12px; line-height: 16px; }
      .${P}-fail { color: var(--dsw-alias-label-error, #c0392b); }
      .${P}-bar {
        height: 2px;
        border-radius: 2px;
        background: var(--dsw-alias-fill-secondary, rgb(0 0 0 / 6%));
        overflow: hidden;
      }
      .${P}-bar > i { display: block; height: 100%; background: var(--dsw-alias-label-secondary, #81858c); }
      .${P}-x {
        flex: none;
        width: 22px; height: 22px;
        display: inline-flex; align-items: center; justify-content: center;
        border: none; border-radius: 6px; background: transparent;
        color: var(--dsw-alias-label-secondary, #81858c);
        cursor: pointer; font-size: 14px; line-height: 1; padding: 0;
      }
      .${P}-x:hover { background: var(--dsw-alias-button-floating-hover, rgb(241 243 245)); }
      .${P}-drop {
        display: flex; align-items: center; justify-content: center;
        padding: 10px;
        border: 1px dashed var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 12px;
        color: var(--dsw-alias-label-secondary, #81858c);
        font-size: 13px;
      }
      .${P}-drop[data-over='true'] {
        border-color: var(--dsw-alias-label-primary, #0f1115);
        color: var(--dsw-alias-label-primary, #0f1115);
      }
      .${P}-document {
        margin: 0; padding: 12px 14px; max-height: 420px; overflow: auto;
        border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 10px;
        background: var(--dsw-alias-fill-secondary, rgb(0 0 0 / 3%));
        color: var(--dsw-alias-label-primary, inherit);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px; line-height: 1.6; white-space: pre;
      }
      .${P}-button {
        display: inline-flex; align-items: center; height: 32px; padding: 0 14px;
        border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 10px;
        background: var(--dsw-alias-button-elevated-fill, #fff);
        color: var(--dsw-alias-label-primary, inherit);
        font-family: inherit; font-size: 13px; cursor: pointer;
      }
      .${P}-button:hover { background: var(--dsw-alias-button-floating-hover, rgb(241 243 245)); }
      .${P}-sandbox {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; width: 100%; padding: 8px 4px;
        border-top: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 8%));
        margin-top: 4px;
      }
      .${P}-sandbox-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .${P}-sandbox-title { font-size: 12px; color: var(--dsw-alias-label-secondary, #81858c); line-height: 16px; }
      .${P}-sandbox-state {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; color: var(--dsw-alias-label-primary, inherit); line-height: 16px;
      }
      .${P}-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
      .${P}-rings { display: inline-flex; gap: 6px; flex: none; }
      .${P}-ring { position: relative; display: inline-flex; align-items: center; justify-content: center; }
      .${P}-ring-label {
        position: absolute; font-size: 9px; line-height: 1;
        color: var(--dsw-alias-label-secondary, #81858c);
      }
    `

    /** The stylesheet, mounted by whichever of our seats renders first. */
    const Style = () => React.createElement('style', null, STYLE)

    /** A paperclip, at the size the composer's own chrome uses. */
    const Clip = ({ size = 16 }) => React.createElement('svg', {
      width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      className: `${P}-icon`,
    }, React.createElement('path', {
      d: 'M10.5 5 6 9.5a1.5 1.5 0 0 0 2.1 2.1l4.9-4.9a3 3 0 1 0-4.2-4.2L3.6 7.2a4.5 4.5 0 0 0 6.4 6.4l4-4',
      stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
    }))

    // ------------------------------------------------------------ the cards --

    /**
     * The attachment cards, rendered where dsh renders its own image rail.
     *
     * The slot this registers into (`conversation.input.dock`) paints a row
     * ABOVE the composer card, and dsh's image thumbnails sit INSIDE it, above
     * the textarea. That seat — `accessory` on the composer bar's owner props —
     * is not a slot, so this puts a container of its own where the rail lives
     * and renders into it through a portal.
     *
     * A forgery, like the spliced `+` group, and reported upstream with it. It
     * keys on the textarea rather than on the card's hashed class name, and it
     * re-seats its container when React rebuilds the composer.
     *
     * @param {object} props - the session standard kit.
     * @returns {object|null} the cards, or nothing to show.
     */
    const AttachmentCards = ({ useSession, sessionId }) => {
      const rows = useRows()
      const [dragging, setDragging] = React.useState(false)
      const running = useSession((state) => state.running) ?? false
      const [seat, setSeat] = React.useState(null)
      // A node React owns and never moves: the anchor the placement below walks
      // up from, so the composer card is found by structure rather than by a
      // document-wide query.
      const anchor = React.useRef(null)
      // Cards belong to the session they were uploaded from; the store is one
      // module-level list shared by every scope that mounts this.
      const mine = rows.filter((row) => row.sessionId === sessionId)

      composer.sessionId = sessionId

      // A container of our own, placed in the composer card and filled through
      // a portal.
      //
      // Moving React's OWN node there instead is what froze the page: React
      // still believes the node is a child of the dock container, and the first
      // time it unmounts the entry — which happens when the composer is rebuilt
      // on the blank-to-active flip — `removeChild` throws on a node that is no
      // longer there, and it throws again on every retry. A portal inverts it:
      // React renders into a container it does not own the position of, and
      // this side owns nothing React renders.
      const held = React.useRef(null)
      held.current ??= (() => {
        const container = document.createElement('div')
        container.dataset.dshSandboxHost = 'attachments'
        return container
      })()

      // Placed after every render, which costs one `isConnected` read in the
      // case that matters and a walk only when the composer has been rebuilt.
      //
      // The first cut watched `document.body` for childList instead. That is a
      // callback on every React commit anywhere in the page — every token of a
      // streaming reply — each one running a document-wide
      // `querySelector('textarea')`. It is also unnecessary: this component
      // re-renders on the same commit that rebuilds the composer, because the
      // input state it reads changes with it.
      React.useLayoutEffect(() => {
        const container = held.current
        // The whole cost in the common case. Everything below runs once, and
        // again only when the composer has been rebuilt under it.
        if (container.isConnected) return
        const dock = anchor.current
        if (dock === null) return
        // The textarea belonging to THIS composer, found by walking up from a
        // node React keeps in the dock row rather than by a document-wide
        // query — so another textarea elsewhere on the page cannot claim it.
        // The walk stops at the first ancestor that contains one, which is the
        // input bar; the card is that textarea's own scroll region's parent.
        let scope = dock.parentElement
        let input = null
        while (scope !== null && input === null) {
          input = scope.querySelector('textarea')
          if (input === null) scope = scope.parentElement
        }
        const scroll = input?.parentElement?.parentElement
        if (scroll === undefined || scroll === null || scroll.parentElement === null) return
        scroll.before(container)
        setSeat(container)
      })

      React.useEffect(() => () => { held.current?.remove() }, [])

      // The turn claims the notices, so the cards have nothing left to say.
      const wasRunning = React.useRef(running)
      React.useEffect(() => {
        if (running && !wasRunning.current) store.settle()
        wasRunning.current = running
      }, [running])

      // Non-image file drags, taken before dsh sees them.
      //
      // dsh claims document-level drops for the image rail and answers anything
      // else with "仅支持 PNG、JPG、WebP、GIF 格式的图片" — true of its own
      // attachment plane and false of this deployment. Capture phase plus
      // `stopPropagation` means its handler never runs for a drag carrying no
      // image at all; a drag carrying one is left entirely alone.
      React.useEffect(() => {
        const onlyFiles = (transfer) => {
          const items = [...(transfer?.items ?? [])].filter((item) => item.kind === 'file')
          return items.length > 0 && items.every((item) => !String(item.type).startsWith('image/'))
        }
        // The hint is driven from here rather than from a window listener,
        // because `stopPropagation` at capture means nothing further out ever
        // sees these events.
        let depth = 0
        const guard = (event) => {
          if (!onlyFiles(event.dataTransfer)) return
          event.stopPropagation()
          if (event.type === 'dragenter') { depth += 1; setDragging(true); return }
          if (event.type === 'dragleave') {
            depth = Math.max(0, depth - 1)
            if (depth === 0) setDragging(false)
            return
          }
          event.preventDefault()
          if (event.type !== 'drop') return
          depth = 0
          setDragging(false)
          sendFiles(event.dataTransfer?.files ?? [])
        }
        const kinds = ['dragenter', 'dragover', 'dragleave', 'drop']
        for (const kind of kinds) document.addEventListener(kind, guard, true)
        return () => { for (const kind of kinds) document.removeEventListener(kind, guard, true) }
      }, [])

      /**
       * Take a card off the message, and the notice off the agent with it.
       * @param {object} row - the card's row.
       */
      const detach = (row) => {
        if (row.messageId !== undefined) {
          void call('upload.retract', { sessionId, messageId: row.messageId }).catch(() => {})
        }
        store.remove(row.key)
      }

      const body = !dragging && mine.length === 0
        ? null
        : React.createElement(
          'div',
          { className: `${P}-cards` },
          React.createElement(Style),
          dragging && mine.length === 0 && React.createElement(
            'div',
            { className: `${P}-drop` },
            '松手即可上传到你的沙箱',
          ),
          ...mine.map((row) => {
            const done = row.path !== undefined
            const failed = row.error !== undefined
            return React.createElement(
              'div',
              { key: row.key, className: `${P}-card` },
              React.createElement(Clip, null),
              React.createElement(
                'span',
                { className: `${P}-text` },
                React.createElement('span', { className: `${P}-name`, title: row.path ?? row.name }, row.name),
                React.createElement(
                  'span',
                  { className: `${P}-meta${failed ? ` ${P}-fail` : ''}` },
                  failed ? row.error : done ? humanBytes(row.size) : `上传中 ${humanBytes(row.sent)} / ${humanBytes(row.size)}`,
                ),
                !done && !failed && React.createElement(
                  'span',
                  { className: `${P}-bar` },
                  React.createElement('i', {
                    style: { width: `${String(row.size === 0 ? 100 : Math.round((row.sent / row.size) * 100))}%` },
                  }),
                ),
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: `${P}-x`,
                  // The wording dsh uses for the same gesture on an image is
                  // "移除图片 <name>"; this is its sibling.
                  title: `移除附件 ${row.name}`,
                  'aria-label': `移除附件 ${row.name}`,
                  onClick: () => { detach(row) },
                },
                '×',
              ),
            )
          }),
        )

      return React.createElement(
        React.Fragment,
        null,
        React.createElement('div', { ref: anchor, style: { display: 'none' } }),
        seat === null ? null : ReactDom.createPortal(body, seat),
      )
    }

    // ------------------------------------------------------ the + addition --

    /**
     * Read the class names an element carries, minus the ones that mark state.
     *
     * The shell's classes are content-hashed CSS-module names, so they cannot
     * be written down — but they can be READ off the live element, which is
     * better than restating the rules they stand for: the group below then
     * inherits hover, focus and theme from the same stylesheet the real rows
     * use, and keeps inheriting them through an upstream restyle.
     *
     * The intersection across siblings is what drops the state classes: the
     * highlighted row carries one the others do not.
     *
     * @param {NodeListOf<Element>|Element[]} kin - the siblings to compare.
     * @returns {string} the classes every one of them has.
     */
    const sharedClasses = (kin) => {
      const lists = [...kin].map((el) => [...el.classList])
      if (lists.length === 0) return ''
      return lists[0].filter((name) => lists.every((list) => list.includes(name))).join(' ')
    }

    /**
     * The "附件" group, added to the `+` menu's own panel.
     *
     * The honest route is closed: `+` calls
     * `inputTriggers.toggleSource('command', …)`, which seeds the menu with
     * exactly one source, so a registered source appears when the person types
     * `/` and never under `+`. Reported upstream; see docs/sandbox-pitfalls.md.
     *
     * So this puts its group INSIDE the shipped panel rather than drawing a
     * second one above it — the person sees one card, which is what a menu is.
     * Everything it keys on is a role or an ARIA state: the panel is
     * `[role=listbox]`, its rows are `[role=option]`, its headings are
     * `[role=presentation][data-source]`, and whether to appear at all comes
     * from `aria-expanded` on the `+` button, true only for the launcher and
     * false while the person is typing a trigger.
     *
     * The container goes in as the panel's first child and React renders into
     * it through a portal — never a node moved after the fact, which is what
     * froze the page when the attachment cards did it.
     *
     * @returns {object|null} the group, or nothing.
     */
    const PlusAttachmentGroup = () => {
      const [seat, setSeat] = React.useState(null)
      const [look, setLook] = React.useState(null)
      const held = React.useRef(null)
      held.current ??= document.createElement('div')

      React.useEffect(() => {
        const container = held.current
        /** The panel currently being watched for its rows arriving. */
        const watched = { viewport: null, observer: null }

        /** Stop following a panel that has gone. */
        const unwatch = () => {
          watched.observer?.disconnect()
          watched.viewport = null
          watched.observer = null
        }

        /** Find the launcher's panel and sit in it, or leave. */
        const place = () => {
          const launcher = document.querySelector('button[aria-haspopup="listbox"][aria-expanded="true"]')
          const panel = launcher === null ? null : document.querySelector('[role="listbox"]')
          // `data-source` is the shell's own marking, so this cannot pick up
          // the heading rendered below — but the filter above is the rule, and
          // this is the one place it is enforced by the selector instead.
          const heading = panel?.querySelector('[role="presentation"][data-source]')
          // The viewport is whatever holds the headings; naming it by class
          // would be naming a hash.
          const viewport = heading?.parentElement
          if (viewport === undefined || viewport === null) {
            unwatch()
            container.remove()
            setSeat(null)
            return
          }
          // The rows arrive after the panel does — the source is asked for its
          // candidates asynchronously, and the first frames hold a loading row
          // instead. Measuring then yields nothing to copy, which is how the
          // group rendered once as an unstyled button. Watching the viewport
          // costs nothing while the menu is shut and ends when it closes.
          if (watched.viewport !== viewport) {
            unwatch()
            watched.viewport = viewport
            watched.observer = new MutationObserver(() => { place() })
            watched.observer.observe(viewport, { childList: true })
          }
          if (container.parentElement !== viewport || container.previousSibling !== null) {
            viewport.prepend(container)
          }
          // Everything measured has to come from the shell's own rows, never
          // from ours: this runs again after the group is in place, and the
          // intersection with a row of ours that has not been styled yet is
          // empty — which is how the group rendered once as a bare button.
          const theirs = (selector) => [...panel.querySelectorAll(selector)]
            .filter((el) => !container.contains(el))
          const next = {
            heading: heading.className,
            option: sharedClasses(theirs('[role="option"]')),
            name: sharedClasses(theirs('[role="option"] > span:first-child')),
            description: sharedClasses(theirs('[role="option"] > span:last-child')),
          }
          setSeat(container)
          // Replaced only when it actually differs: placing the group is
          // itself a mutation of the viewport, and a new object every time
          // would re-render on the observation of our own work.
          setLook((current) => (current !== null
            && current.heading === next.heading
            && current.option === next.option
            && current.name === next.name
            && current.description === next.description
            ? current
            : next))
        }

        // `aria-expanded` alone, not the subtree: watching childList over the
        // document would re-run this on every token of a streaming reply, and
        // the one signal that matters is the launcher opening or closing. The
        // panel is built in the same gesture, sometimes a frame later, so each
        // flip is handled now and again on the next frame.
        const soon = () => { place(); requestAnimationFrame(place) }
        soon()
        const observer = new MutationObserver(soon)
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
        return () => {
          observer.disconnect()
          unwatch()
          container.remove()
        }
      }, [])

      // Nothing until there is something to copy: a row rendered before the
      // shell's own have arrived is a row with no styling at all.
      if (seat === null || look === null || look.option === '') return null

      return ReactDom.createPortal(
        React.createElement(
          React.Fragment,
          null,
          React.createElement('div', { className: look.heading, role: 'presentation' }, GROUP),
          React.createElement(
            'button',
            {
              type: 'button',
              role: 'option',
              'aria-selected': false,
              className: look.option,
              // The composer keeps focus through its own chrome the same way.
              onMouseDown: (event) => { event.preventDefault() },
              onClick: () => {
                // Closing is the launcher's own toggle: a click inside the
                // composer area is not the outside-pointer gesture that
                // dismisses the menu.
                document.querySelector('button[aria-haspopup="listbox"][aria-expanded="true"]')?.click()
                pickAndSend()
              },
            },
            React.createElement('span', { className: look.name }, ITEM.name),
            React.createElement('span', { className: look.description }, ITEM.description),
          ),
        ),
        seat,
      )
    }

    // --------------------------------------------------------- sandbox bar --

    /** How often the footer asks the sandbox how it is doing. */
    const STATS_INTERVAL_MS = 5000

    /** Ring geometry, matching the 3px stroke the sidebar's own chrome uses. */
    const RING = { size: 34, r: 13, width: 3 }
    const CIRCUMFERENCE = 2 * Math.PI * RING.r

    /**
     * One metric as a ring.
     *
     * Two circles: the track, and an arc drawn with `stroke-dasharray` — the
     * usual way to draw a fraction of a circle without a path calculation. It
     * starts at twelve o'clock because a gauge that starts at three reads as
     * broken to everyone who has seen any other gauge.
     *
     * @param {object} props - label, fraction (0..1 or null), and the title.
     * @returns {object} the ring.
     */
    const Ring = ({ label, value, title }) => {
      const known = typeof value === 'number' && Number.isFinite(value)
      const shown = known ? Math.min(1, Math.max(0, value)) : 0
      // Green until it is worth noticing, then amber, then red. The thresholds
      // are where a person would want to act, not evenly spaced.
      const stroke = !known
        ? 'var(--dsw-alias-border-l2, rgb(0 0 0 / 12%))'
        : shown >= 0.9 ? 'var(--dsw-alias-label-error, #c0392b)'
          : shown >= 0.7 ? '#d98324'
            : 'var(--dsw-alias-label-success, #2f9e5e)'
      return React.createElement(
        'span',
        { className: `${P}-ring`, title },
        React.createElement(
          'svg',
          { width: RING.size, height: RING.size, viewBox: `0 0 ${String(RING.size)} ${String(RING.size)}`, 'aria-hidden': true },
          React.createElement('circle', {
            cx: RING.size / 2, cy: RING.size / 2, r: RING.r, fill: 'none',
            stroke: 'var(--dsw-alias-fill-secondary, rgb(0 0 0 / 6%))', strokeWidth: RING.width,
          }),
          known && React.createElement('circle', {
            cx: RING.size / 2, cy: RING.size / 2, r: RING.r, fill: 'none',
            stroke, strokeWidth: RING.width, strokeLinecap: 'round',
            strokeDasharray: CIRCUMFERENCE,
            strokeDashoffset: CIRCUMFERENCE * (1 - shown),
            transform: `rotate(-90 ${String(RING.size / 2)} ${String(RING.size / 2)})`,
          }),
        ),
        React.createElement('span', { className: `${P}-ring-label` }, label),
      )
    }

    /**
     * The sandbox's own account of itself, at the sidebar's foot.
     *
     * Running is not asked for and could not be answered from inside: a
     * sandbox that is not running answers nothing, and the gateway says so
     * with a 503. So the state is read from whether the call arrives at all —
     * the only version of the question that is not a guess.
     *
     * Polled rather than pushed. A push would need a frame kind in the tunnel
     * protocol and a gateway that holds per-tenant state; a poll costs one
     * small round trip every few seconds and only while somebody is looking.
     *
     * @param {object} props - the sidebar's owner share (`wide`).
     * @returns {object|null} the status row.
     */
    const SandboxStatus = ({ wide }) => {
      const [state, setState] = React.useState({ status: 'unknown', stats: null })

      React.useEffect(() => {
        let live = true
        let timer
        const tick = async () => {
          try {
            const stats = await call('sandbox.stats', {})
            if (live) setState({ status: 'running', stats })
          } catch {
            // Any failure means the same thing to a person: their sandbox is
            // not answering. Which HTTP status it was is a detail for a log.
            if (live) setState((current) => ({ status: 'starting', stats: current.stats }))
          }
          if (live) timer = setTimeout(() => { void tick() }, STATS_INTERVAL_MS)
        }
        void tick()
        return () => { live = false; clearTimeout(timer) }
      }, [])

      const { status, stats } = state
      const dot = status === 'running' ? 'var(--dsw-alias-label-success, #2f9e5e)'
        : status === 'starting' ? '#d98324'
          : 'var(--dsw-alias-border-l2, rgb(0 0 0 / 25%))'
      const text = status === 'running' ? '运行中' : status === 'starting' ? '连接中' : '未知'

      const pct = (part) => (part && part.totalBytes > 0 ? part.usedBytes / part.totalBytes : null)
      const gb = (bytes) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
      const asText = (part) => (part ? `${gb(part.usedBytes)} / ${gb(part.totalBytes)}` : '未知')

      // Nothing at all on the 56px rail. A lone dot there was the first cut,
      // and it read as a stray mark: with no label beside it, nothing says the
      // colour is about a sandbox, and the three rings it stood in for cannot
      // fit at that width either. The row returns when the column does — which
      // is also what the shell's own chrome does with everything it cannot
      // render narrow.
      if (!wide) return null

      return React.createElement(
        'div',
        { className: `${P}-sandbox` },
        React.createElement(Style),
        React.createElement(
          'span',
          { className: `${P}-sandbox-text` },
          React.createElement('span', { className: `${P}-sandbox-title` }, '沙箱'),
          React.createElement(
            'span',
            { className: `${P}-sandbox-state` },
            React.createElement('span', { className: `${P}-dot`, style: { background: dot } }),
            text,
          ),
        ),
        React.createElement(
          'span',
          { className: `${P}-rings` },
          React.createElement(Ring, {
            label: 'CPU',
            value: stats?.cpu ?? null,
            title: stats?.cpu === null || stats?.cpu === undefined
              ? 'CPU：正在测量'
              : `CPU ${String(Math.round(stats.cpu * 100))}%${stats.cores ? `（${String(stats.cores)} 核）` : ''}`,
          }),
          React.createElement(Ring, {
            label: '内存', value: pct(stats?.memory), title: `内存 ${asText(stats?.memory)}`,
          }),
          React.createElement(Ring, {
            label: '磁盘', value: pct(stats?.disk), title: `磁盘 ${asText(stats?.disk)}`,
          }),
        ),
      )
    }

    // ------------------------------------------------------------- settings --

    /**
     * The configuration document, read rather than opened.
     *
     * A page rather than a header button, because the gesture changed. The
     * shipped control hands a path to the host desktop; there is no desktop
     * here, so what a person can actually be given is the document itself —
     * and a document does not fit in the header's action row.
     *
     * Read-only on purpose. Everything the file holds is editable in the
     * sections beside this one, and an editor here would be a second, weaker
     * way to write the same values — one with no schema behind it.
     *
     * @returns {object} the page.
     */
    const ConfigurationSection = () => {
      const [state, setState] = React.useState({ status: 'loading' })

      React.useEffect(() => {
        let live = true
        void call('document.read', {})
          .then((value) => { if (live) setState({ status: 'ready', ...value }) })
          .catch((error) => { if (live) setState({ status: 'failed', message: error.message }) })
        return () => { live = false }
      }, [])

      const secondary = { color: 'var(--dsw-alias-label-secondary, #81858c)', fontSize: '13px' }

      if (state.status === 'loading') {
        return React.createElement('p', { style: secondary }, '读取中…')
      }
      if (state.status === 'failed') {
        return React.createElement('p', { style: { ...secondary, color: 'var(--dsw-alias-label-error, #c0392b)' } },
          `无法读取配置文件：${state.message}`)
      }

      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '46rem' } },
        React.createElement(Style),
        React.createElement(
          'p',
          { style: { ...secondary, margin: 0 } },
          '你的后端运行在沙箱里，这个文件在那台机器上，不在你的电脑上——所以它在这里显示，而不是被打开。',
        ),
        React.createElement(
          'code',
          { style: { ...secondary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } },
          state.path,
        ),
        React.createElement('pre', { className: `${P}-document` }, state.text === '' ? '（空）' : state.text),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: '8px' } },
          React.createElement(
            'button',
            {
              type: 'button',
              className: `${P}-button`,
              onClick: () => { void navigator.clipboard?.writeText(state.text) },
            },
            '复制',
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: `${P}-button`,
              onClick: () => {
                // Saved from a Blob rather than fetched from a URL: the bytes
                // are already here, and a URL for them would be a second
                // surface for the gateway to authenticate.
                const url = URL.createObjectURL(new Blob([state.text], { type: 'text/plain' }))
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = state.path.split('/').pop() ?? 'settings'
                anchor.click()
                URL.revokeObjectURL(url)
              },
            },
            '下载',
          ),
        ),
      )
    }

    // --------------------------------------------------------------- mount --

    return {
      inject: ['slots', 'connection'],
      /**
       * Register the seats.
       * @param {object} ctx - client root context.
       */
      apply(ctx) {
        plugin = ctx

        ctx.effect(
          () => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
            { name: 'conversation.input.dock', id: 'sandbox-attachments', order: 100 },
            AttachmentCards,
          )),
          'sandbox-host: attachment cards',
        )

        ctx.effect(
          () => ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register(
            { name: 'conversation.input.overlay', id: 'sandbox-attach-group', order: 100 },
            PlusAttachmentGroup,
          )),
          'sandbox-host: attachment group spliced onto the + menu',
        )

        // The honest entry: a trigger source, so "附件" is a group beside
        // "命令" whenever the person types `/`. Optional rather than injected
        // at the plugin level — a composition without ui-input-trigger should
        // lose this entry, not the uploads.
        ctx.inject(['inputTriggers'], (triggerCtx) => {
          triggerCtx.effect(
            () => triggerCtx.inputTriggers.registerSource({
              trigger: '/',
              // The menu titles a group by looking its source name up in the
              // shell's dictionary and returning an unknown key verbatim, so
              // the name IS the heading.
              name: GROUP,
              order: 50,
              candidates: () => Promise.resolve([ITEM]),
              /**
               * Open the picker, and clear the trigger token.
               * @returns {{text: string}} the token's replacement.
               */
              onPick: () => {
                pickAndSend()
                // Not 'handled': that outcome leaves the `/` the person typed
                // sitting in the draft, because nothing consumes the span.
                return { text: '' }
              },
            }),
            'sandbox-host: 附件 trigger source',
          )
        })

        // Beside the settings control at the sidebar's foot. A list slot, so
        // this adds a row rather than replacing anything.
        ctx.effect(
          () => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'sandbox-status', order: 100 },
            SandboxStatus,
          )),
          'sandbox-host: sandbox status row',
        )

        ctx.effect(
          () => ctx.slots.inject('settings.section', () => ctx.slots.register(
            { name: 'settings.section', id: 'configuration', order: 890, label: '配置文件' },
            ConfigurationSection,
          )),
          'sandbox-host: settings configuration section',
        )

        // The header action seat, left empty because its capability moved to
        // the page above — not because the control was inconvenient.
        //
        // `settings.openDocument` prepares the document and hands the path to
        // the host desktop. dsh knows there is no desktop here (`host.describe`
        // reports `canOpenPath: false`), but this control does not consult that
        // — it gates on `settings.describe().hasDocument`, which reports
        // whether the file EXISTS. It always does, so the button always shows,
        // and every click ends in "Could not open configuration file".
        //
        // That mismatch is upstream's; see the limitation in
        // docs/sandbox-pitfalls.md. What belongs here is a deployment that does
        // not offer a gesture it cannot perform, and does offer the one it can.
        //
        // `priority`, not `order`: order is nav position within a cell, while
        // priority is the cell's shadowing rank — ascending, lowest renders,
        // and a second registration at the same id and priority throws rather
        // than silently winning.
        ctx.effect(
          () => ctx.slots.inject('settings.action', () => ctx.slots.register(
            { name: 'settings.action', id: 'open-document', priority: -1 },
            () => null,
          )),
          'sandbox-host: relocate the open-document action',
        )
      },
    }
  },
})
