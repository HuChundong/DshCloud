/**
 * The sandbox adaptation layer, browser half.
 *
 * Three surfaces, all of which exist because the backend is not on this
 * machine:
 *
 * - an attach control in the composer, because a path the person can type is
 *   not a path this backend has;
 * - a Configuration page in Settings, because the shipped control hands the
 *   document to a desktop that is not there;
 * - and nothing at all in the Settings header, where that control used to be.
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

    /**
     * The client context, handed to components that need to call the host.
     *
     * Slot components receive the framework's own props; the plugin context is
     * not among them, and all three seats below need it for one thing —
     * `connection.rpc.call`.
     */
    const ClientContext = React.createContext(undefined)

    // ---------------------------------------------------------------- wire --

    /** The channel the host half owns. One path segment; see its module note. */
    const CHANNEL = '/files'

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
     * One call on the file channel, with the envelope's error turned into a
     * thrown one.
     * @param {object} ctx - the client context, for `connection.rpc`.
     * @param {string} endpoint - channel-relative endpoint.
     * @param {object} payload - the request payload.
     * @returns {Promise<object>} the value the host returned.
     */
    const call = async (ctx, endpoint, payload) => {
      const result = await ctx.connection.rpc.call(CHANNEL, endpoint, payload)
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
     * @param {object} ctx - the client context.
     * @param {File} file - the browser's file.
     * @param {(sent: number) => void} onProgress - bytes accepted so far.
     * @returns {Promise<{path: string, name: string, bytes: number}>} the published file.
     */
    const upload = async (ctx, file, onProgress) => {
      const { id, chunkBytes } = await call(ctx, 'upload.begin', { name: file.name, size: file.size })
      try {
        for (let offset = 0; offset < file.size; offset += chunkBytes) {
          const data = await toBase64(file.slice(offset, offset + chunkBytes))
          const { received } = await call(ctx, 'upload.chunk', { id, data })
          onProgress(received)
        }
        return await call(ctx, 'upload.commit', { id })
      } catch (error) {
        // The staging file would age out on its own, but a browser that failed
        // mid-upload is exactly the case where the tenant retries immediately
        // and meets the in-flight limit.
        await call(ctx, 'upload.abort', { id }).catch(() => {})
        throw error
      }
    }

    // --------------------------------------------------------------- store --

    /**
     * What the composer's two seats both need to see.
     *
     * A store rather than props: the control that starts an upload sits inside
     * the composer card and the list that reports on it sits in the row above,
     * and they are separate slot entries with no owner between them.
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
        add(file) {
          const key = nextKey
          nextKey += 1
          rows = [...rows, { key, name: file.name, size: file.size, sent: 0 }]
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
      }
    }

    const store = createStore()

    /**
     * Tail of the upload chain, shared by both seats.
     *
     * One at a time across the whole page, not per component: the two seats
     * that start uploads are separate slot entries, and a file dropped while
     * another is climbing the tunnel is still the same socket's turn.
     */
    let queue = Promise.resolve()

    /**
     * Subscribe a component to the store.
     * @returns {Array<object>} the current rows.
     */
    const useRows = () => {
      const [rows, setRows] = React.useState(store.snapshot)
      React.useEffect(() => store.subscribe(() => { setRows(store.snapshot()) }), [])
      return rows
    }

    /** Whether a drag currently over the page is carrying files. */
    const useFileDrag = () => {
      const [dragging, setDragging] = React.useState(false)
      React.useEffect(() => {
        // Observed, never intercepted. `preventDefault` here would make this
        // plugin the drop target for the whole page, including the image drops
        // the composer already handles itself. Our own element is the only
        // thing that accepts a drop.
        let depth = 0
        const carriesFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files')
        const enter = (event) => {
          if (!carriesFiles(event)) return
          depth += 1
          setDragging(true)
        }
        const leave = () => {
          depth = Math.max(0, depth - 1)
          if (depth === 0) setDragging(false)
        }
        const end = () => { depth = 0; setDragging(false) }
        window.addEventListener('dragenter', enter)
        window.addEventListener('dragleave', leave)
        window.addEventListener('drop', end)
        window.addEventListener('dragend', end)
        return () => {
          window.removeEventListener('dragenter', enter)
          window.removeEventListener('dragleave', leave)
          window.removeEventListener('drop', end)
          window.removeEventListener('dragend', end)
        }
      }, [])
      return dragging
    }

    // ---------------------------------------------------------------- copy --

    /**
     * Human byte count, for a progress line nobody should have to decode.
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

    // --------------------------------------------------------------- style --

    /** Classes the rules below are scoped to; nothing else in the page uses them. */
    const CSS_PREFIX = 'dsh-sandbox-host'

    /**
     * Restated from the shell's own tokens rather than borrowed from it. Every
     * class a shipped control carries is a content-hashed CSS-module name
     * private to its bundle, but the tokens those names are built from are
     * declared on `body` by the theme — so building from the tokens tracks both
     * themes without this file knowing either.
     */
    const STYLE = `
      .${CSS_PREFIX}-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-secondary, #6b6b68);
        cursor: pointer;
      }
      .${CSS_PREFIX}-trigger:hover:not(:disabled) {
        background: var(--dsw-alias-button-floating-hover, rgb(241 243 245));
        color: var(--dsw-alias-label-primary, inherit);
      }
      .${CSS_PREFIX}-trigger:disabled { opacity: 0.4; cursor: default; }
      .${CSS_PREFIX}-dock {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 0 2px 6px;
      }
      .${CSS_PREFIX}-drop {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 14px;
        border: 1px dashed var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 12px;
        color: var(--dsw-alias-label-secondary, #6b6b68);
        font-size: 13px;
      }
      .${CSS_PREFIX}-drop[data-over='true'] {
        border-color: var(--dsw-alias-label-primary, #111);
        color: var(--dsw-alias-label-primary, #111);
      }
      .${CSS_PREFIX}-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 10px;
        background: var(--dsw-alias-button-elevated-fill, #fff);
        font-size: 13px;
      }
      .${CSS_PREFIX}-name {
        flex: 1 1 auto;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .${CSS_PREFIX}-meta { color: var(--dsw-alias-label-secondary, #6b6b68); font-size: 12px; }
      .${CSS_PREFIX}-fail { color: var(--dsw-alias-label-error, #c0392b); }
      .${CSS_PREFIX}-dismiss {
        border: none;
        background: transparent;
        color: var(--dsw-alias-label-secondary, #6b6b68);
        cursor: pointer;
        font-size: 15px;
        line-height: 1;
        padding: 0 2px;
      }
      .${CSS_PREFIX}-document {
        margin: 0;
        padding: 12px 14px;
        max-height: 420px;
        overflow: auto;
        border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 10px;
        background: var(--dsw-alias-fill-secondary, rgb(0 0 0 / 3%));
        color: var(--dsw-alias-label-primary, inherit);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        line-height: 1.6;
        white-space: pre;
      }
      .${CSS_PREFIX}-button {
        display: inline-flex;
        align-items: center;
        height: 32px;
        padding: 0 14px;
        border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
        border-radius: 10px;
        background: var(--dsw-alias-button-elevated-fill, #fff);
        color: var(--dsw-alias-label-primary, inherit);
        font-family: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .${CSS_PREFIX}-button:hover { background: var(--dsw-alias-button-floating-hover, rgb(241 243 245)); }
    `

    /** The stylesheet, mounted once by whichever of our seats renders first. */
    const Style = () => React.createElement('style', null, STYLE)

    // ------------------------------------------------------------- composer --

    /**
     * Start uploads and put what they produce into the draft.
     *
     * The path goes into the draft rather than into an attachment list of our
     * own. That is not a shortcut: on a local host the person types a path and
     * the agent reads it, and a path this deployment produced is the same
     * message. It also keeps the model side untouched — no new content block,
     * no provider contract, nothing that has to agree with the harness about
     * what an attachment is.
     *
     * @param {object} ctx - the client context.
     * @param {object} inputActions - the session's public input face.
     * @param {{current: string}} draftRef - the live draft, read at click time.
     * @returns {(files: FileList | File[]) => void} the handler both seats call.
     */
    const useSend = (ctx, inputActions, draftRef) => React.useCallback((files) => {
      for (const file of files) {
        const key = store.add(file)
        // Chained rather than started together, for two reasons that happen to
        // agree. The tunnel is one socket, so concurrent uploads only take
        // turns more expensively. And the draft is read from a ref that updates
        // on render, so two completions landing in the same frame would both
        // read the draft as it was before either of them, and the second would
        // write over the first's path.
        queue = queue
          .then(() => upload(ctx, file, (sent) => { store.update(key, { sent }) }))
          .then((published) => {
            store.update(key, { path: published.path, sent: published.bytes })
            const draft = draftRef.current
            // A space, not a newline: the path is being named inside whatever
            // sentence the person is writing, and a newline would break it.
            const separator = draft === '' || draft.endsWith(' ') || draft.endsWith('\n') ? '' : ' '
            inputActions?.setDraft(`${draft}${separator}${published.path} `)
            // Flushed here rather than waited for: setDraft is synchronous into
            // the input machine, but the ref this read from only catches up on
            // the next render, and the next file in the chain would otherwise
            // read the stale one.
            draftRef.current = `${draft}${separator}${published.path} `
          })
          .catch((error) => { store.update(key, { error: error.message }) })
      }
    }, [ctx, inputActions, draftRef])

    /**
     * The attach control, in the composer's tool row beside the shipped chrome.
     * @param {object} props - the session standard kit.
     * @returns {object} the button and its file input.
     */
    const AttachControl = ({ useInput, inputActions }) => {
      const ctx = React.useContext(ClientContext)
      const draft = useInput((state) => state.draft)
      const draftRef = React.useRef(draft)
      draftRef.current = draft
      const send = useSend(ctx, inputActions, draftRef)
      const inputRef = React.useRef(null)

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(Style),
        React.createElement('input', {
          ref: inputRef,
          type: 'file',
          multiple: true,
          style: { display: 'none' },
          onChange: (event) => {
            send(event.target.files ?? [])
            // Cleared so that choosing the same file twice in a row still
            // fires a change event.
            event.target.value = ''
          },
        }),
        React.createElement(
          'button',
          {
            type: 'button',
            className: `${CSS_PREFIX}-trigger`,
            title: '上传文件到沙箱',
            'aria-label': '上传文件到沙箱',
            onClick: () => { inputRef.current?.click() },
          },
          React.createElement('svg', {
            width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
          }, React.createElement('path', {
            d: 'M8 11.5V3.5M8 3.5 5 6.5M8 3.5l3 3M3 11v1.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V11',
            stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
          })),
        ),
      )
    }

    /**
     * The row above the composer: a drop target while a drag is in progress,
     * and one line per upload until it is dismissed.
     * @param {object} props - the session standard kit.
     * @returns {object|null} the row, or nothing to say.
     */
    const UploadDock = ({ useInput, inputActions }) => {
      const ctx = React.useContext(ClientContext)
      const draft = useInput((state) => state.draft)
      const draftRef = React.useRef(draft)
      draftRef.current = draft
      const send = useSend(ctx, inputActions, draftRef)
      const rows = useRows()
      const dragging = useFileDrag()
      const [over, setOver] = React.useState(false)

      if (!dragging && rows.length === 0) return null

      return React.createElement(
        'div',
        { className: `${CSS_PREFIX}-dock` },
        React.createElement(Style),
        dragging && React.createElement(
          'div',
          {
            className: `${CSS_PREFIX}-drop`,
            'data-over': String(over),
            onDragOver: (event) => { event.preventDefault(); setOver(true) },
            onDragLeave: () => { setOver(false) },
            onDrop: (event) => {
              event.preventDefault()
              setOver(false)
              send(event.dataTransfer?.files ?? [])
            },
          },
          '把文件拖到这里，上传到你的沙箱',
        ),
        ...rows.map((row) => React.createElement(
          'div',
          { key: row.key, className: `${CSS_PREFIX}-row` },
          React.createElement('span', { className: `${CSS_PREFIX}-name`, title: row.path ?? row.name }, row.name),
          React.createElement(
            'span',
            { className: `${CSS_PREFIX}-meta${row.error === undefined ? '' : ` ${CSS_PREFIX}-fail`}` },
            row.error !== undefined
              ? row.error
              : row.path !== undefined
                ? `已上传 · ${humanBytes(row.size)}`
                : `${humanBytes(row.sent)} / ${humanBytes(row.size)}`,
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: `${CSS_PREFIX}-dismiss`,
              title: '不再显示',
              'aria-label': '不再显示',
              onClick: () => { store.remove(row.key) },
            },
            '×',
          ),
        )),
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
      const ctx = React.useContext(ClientContext)
      const [state, setState] = React.useState({ status: 'loading' })

      React.useEffect(() => {
        let live = true
        void call(ctx, 'document.read', {})
          .then((value) => { if (live) setState({ status: 'ready', ...value }) })
          .catch((error) => { if (live) setState({ status: 'failed', message: error.message }) })
        return () => { live = false }
      }, [ctx])

      const secondary = { color: 'var(--dsw-alias-label-secondary, #6b6b68)', fontSize: '13px' }

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
        React.createElement('pre', { className: `${CSS_PREFIX}-document` }, state.text === '' ? '（空）' : state.text),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: '8px' } },
          React.createElement(
            'button',
            {
              type: 'button',
              className: `${CSS_PREFIX}-button`,
              onClick: () => { void navigator.clipboard?.writeText(state.text) },
            },
            '复制',
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: `${CSS_PREFIX}-button`,
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
       * Register the three seats.
       * @param {object} ctx - client root context.
       */
      apply(ctx) {
        /**
         * Wrap one component so it can reach the plugin context.
         * @param {Function} Component - the seat's component.
         * @returns {Function} the same seat, with the context above it.
         */
        const withContext = (Component) => (props) =>
          React.createElement(ClientContext.Provider, { value: ctx }, React.createElement(Component, props))

        ctx.effect(
          () => ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
            { name: 'conversation.input.left', id: 'sandbox-attach', order: 100 },
            withContext(AttachControl),
          )),
          'sandbox-host: composer attach control',
        )

        ctx.effect(
          () => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
            { name: 'conversation.input.dock', id: 'sandbox-uploads', order: 100 },
            withContext(UploadDock),
          )),
          'sandbox-host: upload dock',
        )

        ctx.effect(
          () => ctx.slots.inject('settings.section', () => ctx.slots.register(
            { name: 'settings.section', id: 'configuration', order: 890, label: '配置文件' },
            withContext(ConfigurationSection),
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
