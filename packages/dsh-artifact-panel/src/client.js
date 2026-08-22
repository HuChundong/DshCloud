/**
 * The right-hand panel, browser half.
 *
 * Three kinds of thing and nothing else: the workspace's files, a shell in the
 * sandbox, and the page the agent is building. See `docs/artifact-panel.zh.md`
 * for the product judgement that bounds the list — the bound is what keeps
 * this from growing into an IDE, and it is a decision rather than a backlog.
 *
 * Everything it shows comes from the sandbox over the gateway's panel routes:
 * `/sandbox/fs/*` to list and change, `/sandbox/raw/*` for bytes, a ticketed
 * `/sandbox/preview/*` for pages that must fetch their own assets, a WebSocket
 * for the terminal, and an event stream for what changed. Nothing here polls;
 * the workspace says when it moved.
 *
 * Two structural choices, both forced:
 *
 * The panel does not live in a slot, and it does not live in the app's React
 * tree. The whole-panel seat is `details`, which `ui-layout` occupies, so a
 * plugin cannot take it — leaving a host element of our own on `document.body`
 * as the only place a full-height panel can go.
 *
 * That host gets its OWN React root rather than a portal out of a slot. The
 * portal was tried first and its rendering is fine; its events are not. React
 * 18 attaches its listeners to a root container, and a click inside a body-level
 * host bubbles `body` -> `html` -> `document` without ever passing through
 * `#root`, so nothing in the panel could be clicked — no error, no warning, a
 * button that simply does nothing. Making the host a root container of its own
 * puts the listeners where the clicks are. The cost is that the panel sits
 * outside the app's React context, which it can afford: everything it needs
 * from the theme arrives as CSS custom properties on `body`, not through
 * context.
 *
 * The panel pushes rather than floats: the conversation column narrows and
 * reflows instead of being covered. It is that column and not the whole app
 * that gives up the width, because the app frame decides whether to collapse
 * the tenant's sidebar by watching its own box — see the rule itself.
 *
 * Written against the module loader the shell installs rather than built from
 * the workspace: `require` here is the shell's module table, which is where
 * React comes from. Nothing in this file resolves through node_modules, so the
 * package needs no build step.
 */
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import terminalCss from '@xterm/xterm/css/xterm.css'
import { extracted } from 'dsh-icons/extracted'
import { mirrored } from 'dsh-icons/mirrored'
import { forgetPath } from './tabs.js'

window.__ModuleLoader__.load({
  id: 'dsh-artifact-panel',
  factory: (require) => {
    const React = require('react')

    /**
     * This plugin's own dictionary namespace; see `dsh-sandbox-host` for why.
     *
     * `LOCALE_NS`, not `NS`: this file already had an `NS`, and it is the CSS
     * class prefix.
     */
    const LOCALE_NS = 'hamsterhq.panel'

    /** The plugin context, captured at mount, for the callers that are not components. */
    let plugin

    /**
     * Translate, and re-render when the language changes.
     * @returns {(key: string, params?: object) => string} the translator.
     */
    const useT = () => {
      React.useSyncExternalStore(
        (notify) => plugin.locale.subscribe(notify),
        () => plugin.locale.getSnapshot(),
      )
      return plugin.locale.bind(LOCALE_NS)
    }

    /** Translate outside a component. */
    const say = () => plugin.locale.bind(LOCALE_NS)

    /**
     * What to show for a problem the server reported: a code, worded here.
     * See `dsh-tenant-account` for why the server does not word it itself.
     * @param {(key: string, params?: object) => string} t - the translator.
     * @param {unknown} problem - whatever the server put in `error`.
     * @param {string} fallback - the key to use when the code is unknown.
     * @returns {string} what to show.
     */
    const fromServer = (t, problem, fallback, values) => {
      const code = typeof problem === 'string' ? problem : problem?.code
      if (typeof code !== 'string') return t(fallback, values)
      const key = `error.${code}`
      const said = t(key, problem?.params)
      return said === key ? t(fallback, values) : said
    }

    /** Everything this plugin says, in both languages. */
    const DICTIONARY = {
      zh: {
        'terminal.n': '终端 {n}',
        terminal: '终端',

        'tool.files': '文件',
        'tool.files.note': '浏览这台沙箱里的工作区',
        'tool.terminal': '终端',
        'tool.terminal.note': '在沙箱里开一个 shell',
        'tool.canvas': '画布',
        'tool.canvas.note': '看 agent 正在做的页面',

        'tab.close': '关闭 {name}',
        'panel.open': '打开工具',
        'panel.expand': '占满',
        'panel.restore': '恢复宽度',
        'panel.collapse': '收起侧边栏',
        'panel.reveal': '打开侧边栏',

        'empty.opened': '已打开',
        'stub.title': '「{name}」还没有接上',
        'stub.note': '这一步只有界面，没有数据。',

        more: '更多',
        'more.of': '{name} 的操作',
        loading: '读取中…',
        'tree.empty': '空目录',
        'tree.nomatch': '没有匹配的文件',
        'filter.placeholder': '筛选文件…',
        'filter.label': '筛选文件',

        'preview.preparing': '准备预览…',
        'preview.opaque': '暂不支持预览。',
        copy: '复制',
        copied: '已复制',
        'copy.text': '复制内容',
        'copied.text': '已复制内容',
        'copy.path': '复制路径',
        'copied.path': '已复制路径',

        expand: '展开{title}',
        collapse: '收起{title}',

        'terminal.end': '结束',
        'terminal.end.of': '结束 {name}',
        'terminal.new': '新建会话',
        'terminal.list': '会话列表',
        'terminal.count': '{n} 个会话',
        'terminal.unreachable': '连不上终端。',
        'terminal.over': '这个会话已经结束了。关掉这个标签再开一个。',

        preview: '预览',
        source: '源码',
        refresh: '刷新',
        'files.tree': '文件树',
        'files.aside': '文件',
        'files.pick': '从右边选一个文件',

        'canvas.looking': '看看有什么…',
        'canvas.none': '还没有页面',
        'canvas.none.note': '让 agent 在工作区里写一个 .html，这里会自己出现。',
        reload: '重新加载',

        'menu.create': '新建文件',
        'menu.mkdir': '新建文件夹',
        'menu.rename': '重命名',
        'menu.delete': '删除',

        'ask.delete': '删除',
        'ask.rename': '重命名',
        'ask.mkdir': '新建文件夹',
        'ask.create': '新建文件',
        'ask.delete.directory': '确定删除目录「{name}」及其全部内容？此操作不可撤销。',
        'ask.delete.file': '确定删除文件「{name}」？此操作不可撤销。',
        'ask.name.folder': '文件夹名称',
        'ask.name.file': '文件名称',
        'ask.name.new': '新的名称',
        'ask.noslash': '名称里不能有 /',
        'ask.cancel': '取消',
        'ask.busy': '处理中…',
        'ask.confirm': '确定',

        'crashed': '侧边栏出错了',

        // Keyed by the codes the gateway sends; anything else falls back to
        // the plain wording beside it.
        'error.read': '读取失败（{status}）',
        'error.act': '操作失败（{status}）',
        'error.preview': '无法预览这个文件',
        'error.sandbox.not_ready': '沙箱还没准备好，请稍后再试。',
        'error.sandbox.silent': '沙箱没有回应。',
        'error.file.unreadable': '读不到这个文件。',
      },
      en: {
        'terminal.n': 'Terminal {n}',
        terminal: 'Terminal',

        'tool.files': 'Files',
        'tool.files.note': 'Browse the workspace on this sandbox',
        'tool.terminal': 'Terminal',
        'tool.terminal.note': 'Open a shell in the sandbox',
        'tool.canvas': 'Canvas',
        'tool.canvas.note': 'See the page the agent is building',

        'tab.close': 'Close {name}',
        'panel.open': 'Open a tool',
        'panel.expand': 'Fill the window',
        'panel.restore': 'Restore the width',
        'panel.collapse': 'Collapse the panel',
        'panel.reveal': 'Open the panel',

        'empty.opened': 'open',
        'stub.title': '“{name}” is not wired up yet',
        'stub.note': 'This step is the interface only; there is no data behind it.',

        more: 'More',
        'more.of': 'Actions for {name}',
        loading: 'Reading…',
        'tree.empty': 'Empty directory',
        'tree.nomatch': 'No file matches',
        'filter.placeholder': 'Filter files…',
        'filter.label': 'Filter files',

        'preview.preparing': 'Preparing the preview…',
        'preview.opaque': 'Preview is not supported yet.',
        copy: 'Copy',
        copied: 'Copied',
        'copy.text': 'Copy the contents',
        'copied.text': 'Contents copied',
        'copy.path': 'Copy the path',
        'copied.path': 'Path copied',

        expand: 'Show {title}',
        collapse: 'Hide {title}',

        'terminal.end': 'End',
        'terminal.end.of': 'End {name}',
        'terminal.new': 'New session',
        'terminal.list': 'Sessions',
        'terminal.count': '{n} sessions',
        'terminal.unreachable': 'Could not reach the terminal.',
        'terminal.over': 'This session has ended. Close the tab and open another.',

        preview: 'Preview',
        source: 'Source',
        refresh: 'Refresh',
        'files.tree': 'File tree',
        'files.aside': 'Files',
        'files.pick': 'Choose a file on the right',

        'canvas.looking': 'Looking for one…',
        'canvas.none': 'No page yet',
        'canvas.none.note': 'Ask the agent to write a .html in the workspace and it appears here by itself.',
        reload: 'Reload',

        'menu.create': 'New file',
        'menu.mkdir': 'New folder',
        'menu.rename': 'Rename',
        'menu.delete': 'Delete',

        'ask.delete': 'Delete',
        'ask.rename': 'Rename',
        'ask.mkdir': 'New folder',
        'ask.create': 'New file',
        'ask.delete.directory': 'Delete the directory “{name}” and everything in it? This cannot be undone.',
        'ask.delete.file': 'Delete the file “{name}”? This cannot be undone.',
        'ask.name.folder': 'Folder name',
        'ask.name.file': 'File name',
        'ask.name.new': 'New name',
        'ask.noslash': 'A name cannot contain /',
        'ask.cancel': 'Cancel',
        'ask.busy': 'Working…',
        'ask.confirm': 'OK',

        'crashed': 'The panel hit an error',

        'error.read': 'Could not read it ({status})',
        'error.act': 'That did not work ({status})',
        'error.preview': 'This file cannot be previewed',
        'error.sandbox.not_ready': 'The sandbox is not ready yet. Try again shortly.',
        'error.sandbox.silent': 'The sandbox did not answer.',
        'error.file.unreadable': 'That file could not be read.',
      },
    }
    const ReactDomClient = require('react-dom/client')
    const h = React.createElement

    /**
     * The app's own markdown renderer and code block.
     *
     * Taken from the shell rather than reimplemented, and that is the whole
     * point: `MarkdownText` and `CodeBlock` are what the conversation already
     * renders with, down to the shiki grammars and the copy button, so a file
     * opened in this panel looks like the same file quoted in a message. A
     * markdown parser and a highlighter of our own would be a second set of
     * rules to keep in step with theirs, and would still look different.
     *
     * Guarded because the module table is the shell's, not ours: a deployment
     * whose shell does not carry this package falls back to plain text rather
     * than failing to render the file at all.
     */
    let primitives = {}
    try {
      // `?? {}` and not just the call: a module table that does not carry this
      // id answers `undefined` rather than throwing, and every use below is a
      // property read — which on `undefined` is a TypeError during render, and
      // a render error takes the whole root down. The panel then vanishes
      // completely over an optional dependency.
      primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {}
    } catch (error) {
      console.warn('[dsh-artifact-panel] ui-primitives did not load; files render as plain text', error)
    }
    window.__panelBoot = { factory: true, markdown: primitives.MarkdownText !== undefined, code: primitives.CodeBlock !== undefined }
    console.info('[dsh-artifact-panel] markdown:', primitives.MarkdownText !== undefined, 'code:', primitives.CodeBlock !== undefined)

    /** Prefix every class this file writes, so nothing here can collide. */
    const NS = 'dsh-artifact-panel'

    /**
     * The attribute the panel's root host carries.
     *
     * The anchor a skin or an outside stylesheet scopes to. CSS-module class
     * names in this app are content hashes and change between builds, so they
     * are not a contract; this is.
     */
    const ANCHOR = 'data-dsh-artifact-panel'

    /** The layout variable `#root` gives up its margin to, in `px`. */
    const WIDTH_VAR = '--dsh-artifact-panel-width'

    /**
     * The height of the host's session header, in `px`.
     *
     * The panel's tab bar matches it so the two rules across the top of the
     * window are one line rather than two that nearly agree. Measured rather
     * than restated: the header's height depends on the row merge below, on
     * whether a session exists at all, and on whatever upstream does to it
     * next. The fallback is what it measures today, for the moment before the
     * first measurement and for a deployment with no header to measure.
     */
    const HEADER_HEIGHT_VAR = '--dsh-artifact-panel-header-height'

    /** Set on `body` while a drag is in flight, to suspend the transitions. */
    const DRAGGING = 'data-dsh-artifact-panel-dragging'

    /**
     * The session header, addressed by the slot it is rendered into.
     *
     * A slot name is a published contract where a class name is a build
     * artifact, so everything this file says about the host's own chrome is
     * anchored here.
     */
    const HEADER = '[data-slot=\'conversation.session.header\'] > header'

    /**
     * The session header, but only while it is shaped the way the merge below
     * expects: a header whose second row holds ARIA tabs.
     *
     * Named once because it is one assumption, not eleven. Every rule that
     * rearranges upstream's header hangs off this guard, so if upstream moves
     * that row, renames it, or drops the roles, all of them stop matching
     * together and the header renders exactly as upstream draws it. A guard
     * repeated per rule could drift rule by rule and leave the header half
     * rearranged, which is the one failure this must not have.
     */
    const MERGED_HEADER = `${HEADER}:has(> div:nth-child(2) > [role='tab'])`

    /**
     * The panel's open state, held outside React.
     *
     * Two React roots need it: the panel's own, and the app's — the toggle
     * lives in the app's header, because that is where the control belongs and
     * a control that moves house when the thing it controls opens is a control
     * nobody can aim at. A store both roots subscribe to is how one piece of
     * state reaches two trees without either owning the other.
     */
    /** The tab group of a session that has none yet. */
    const EMPTY_GROUP = Object.freeze({ tabs: Object.freeze([]), activeId: undefined })

    /** What a session with no id at all is filed under — the home screen. */
    const NO_SESSION = ''

    const store = (() => {
      let state = Object.freeze({
        open: false,
        header: false,
        session: NO_SESSION,
        groups: {},
        // Shells, kept here rather than in the component that draws them: a
        // terminal is a process, and closing the tab it is drawn in should not
        // be the same gesture as ending it.
        terminals: [],
        activeTerminal: undefined,
        nextTerminal: 1,
        // Which side columns are folded away, by the kind of pane they belong
        // to. Two flags rather than one, because folding the file tree to read
        // a file says nothing about wanting the terminal list gone.
        folded: {},
      })
      const listeners = new Set()
      const emit = () => { for (const listener of listeners) listener() }
      const write = (patch) => {
        state = Object.freeze({ ...state, ...patch })
        emit()
      }
      /** Replace the current session's group, leaving every other one alone. */
      const writeGroup = (next) => {
        write({ groups: { ...state.groups, [state.session]: Object.freeze(next) } })
      }
      const group = () => state.groups[state.session] ?? EMPTY_GROUP

      return {
        read: () => state,
        write,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        group,
        /**
         * Follow the app's current session.
         *
         * Tabs belong to a conversation, not to the window: what was opened
         * while reading one session is not what the next one is about. Groups
         * are kept rather than cleared, so going back to a session finds the
         * files that were open in it.
         */
        setSession: (session) => {
          if (state.session === (session ?? NO_SESSION)) return
          write({ session: session ?? NO_SESSION })
        },
        /** Open a tab, or focus the one already showing that thing. */
        openTab: (tab) => {
          const { tabs } = group()
          writeGroup({
            tabs: tabs.some((entry) => entry.id === tab.id) ? tabs : [...tabs, tab],
            activeId: tab.id,
          })
        },
        /**
         * Close one tab, and the panel with it when it was the last.
         *
         * Closing the last tab is how someone says they are done with the
         * panel — there is nothing left in it to look at, and what stayed
         * behind was a half-width empty state they then had to dismiss a
         * second time, with a different control, to get their reading width
         * back. The panel can still be opened onto that empty state
         * deliberately; it is only being left on one that is wrong.
         *
         * One write, not two: `open` and the tab group are the same store, and
         * writing them separately paints a frame of an empty open panel.
         */
        closeTab: (id) => {
          const { tabs, activeId } = group()
          const next = tabs.filter((entry) => entry.id !== id)
          // Focus falls to the neighbour on the left, or the new first tab —
          // the position the eye is already at, rather than the end.
          const index = tabs.findIndex((entry) => entry.id === id)
          const focus = activeId === id ? next[Math.max(0, index - 1)]?.id : activeId
          write({
            groups: { ...state.groups, [state.session]: Object.freeze({ tabs: next, activeId: focus }) },
            ...next.length === 0 ? { open: false } : {},
          })
        },
        /**
         * Drop every tab that is showing something no longer there.
         *
         * A tab is a claim that a file is worth looking at, and a deleted file
         * makes that claim false. Left alone the tab stays on the bar with its
         * name and its icon, and what is under it is an error where the file
         * used to be — the panel insisting on something the workspace has
         * already moved on from.
         *
         * Which tabs those are is decided in `tabs.js`, where it can be asked
         * about directly. What is here is the part that cannot: one write for
         * every group at once, because separate writes paint a frame each, and
         * if the last tab in this session goes, a frame of an open panel with
         * nothing in it.
         *
         * @param {string} path - what was removed.
         */
        forget: (path) => {
          const { groups, changed } = forgetPath(state.groups, path)
          if (!changed) return
          const here = groups[state.session] ?? EMPTY_GROUP
          write({ groups, ...here.tabs.length === 0 ? { open: false } : {} })
        },
        select: (id) => { writeGroup({ ...group(), activeId: id }) },
        /** Start another shell, and show it. */
        addTerminal: () => {
          const id = `t${String(state.nextTerminal)}`
          write({
            terminals: [...state.terminals, { id, name: say()('terminal.n', { n: String(state.nextTerminal) }) }],
            activeTerminal: id,
            nextTerminal: state.nextTerminal + 1,
          })
          return id
        },
        /** End one shell. Its socket closes with it, and so does the process. */
        closeTerminal: (id) => {
          const rest = state.terminals.filter((entry) => entry.id !== id)
          write({
            terminals: rest,
            activeTerminal: state.activeTerminal === id ? rest[rest.length - 1]?.id : state.activeTerminal,
          })
        },
        selectTerminal: (id) => write({ activeTerminal: id }),
        fold: (kind) => write({ folded: { ...state.folded, [kind]: state.folded[kind] !== true } }),
      }
    })()

    /**
     * Read the shared state in either tree.
     * @returns {{open: boolean, header: boolean}} the current state.
     */
    const useStore = () => React.useSyncExternalStore(store.subscribe, store.read)

    /**
     * The workspace tree, held once for the whole panel.
     *
     * Every file tab shows the tree, and each used to own its own copy: its
     * own expansion, its own loading, its own requests. Switching tabs then
     * threw all of that away and asked the sandbox for the same directories
     * again, so the tree collapsed and flickered on every switch.
     *
     * There is one tree in the product, so there is one tree in the state.
     * What is cached is the SHAPE — which directories are open and what each
     * one contains — and a directory already read is shown immediately while
     * it is read again, so switching is instant without going stale: the agent
     * writes files while the tenant is looking at them.
     */
    const treeStore = (() => {
      // `menu` and `ask` are what is being pointed at and what is being asked,
      // held here rather than in a row because only one of each exists at a
      // time and because both are drawn at the panel's level, where they are
      // not clipped by the column the row lives in.
      let state = Object.freeze({
        dirs: {}, open: {}, filter: '', menu: undefined, ask: undefined,
        // The directory the tree was last taken TO, as opposed to the file
        // that is open in the pane. Clicking a breadcrumb is a move, and a
        // move with nothing to show for it is a control that looks broken:
        // the directory it names is usually already expanded, so opening it
        // again changes nothing anyone can see.
        at: undefined,
      })
      const listeners = new Set()
      const emit = () => { for (const listener of listeners) listener() }
      const put = (patch) => { state = Object.freeze({ ...state, ...patch }); emit() }
      const putDir = (path, node) => { put({ dirs: { ...state.dirs, [path]: node } }) }

      const load = (path) => {
        const known = state.dirs[path]
        // Keep showing what is known while asking again. A directory that has
        // never been read shows its loading row; one that has shows its rows.
        putDir(path, { status: known?.entries === undefined ? 'loading' : 'ready', entries: known?.entries })
        listDir(path).then(
          (entries) => putDir(path, { status: 'ready', entries }),
          (error) => putDir(path, { status: 'failed', message: error.message, entries: known?.entries }),
        )
      }

      return {
        read: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        /** Read a directory, from cache first and from the sandbox always. */
        load,
        /** Open or close one directory. */
        toggle: (path) => {
          const open = { ...state.open }
          if (open[path] === true) delete open[path]
          else open[path] = true
          put({ open })
        },
        /**
         * Open every directory on the way to a path, and the path itself when
         * the path IS a directory.
         *
         * `self` is the caller saying which it passed. A file's path names the
         * directories above it and nothing to open at the end; a directory —
         * one clicked in the breadcrumb, one just created — is itself the thing
         * to open, and stopping short of it is stopping one level short of the
         * only level the caller cared about.
         *
         * That distinction used to be made by putting a slash on the end, and
         * `filter(Boolean)` dropped the empty segment before anything could
         * read it. So a breadcrumb click opened only ancestors that the open
         * file had already opened, left `changed` false, and did nothing
         * whatsoever — the control looked dead rather than wrong.
         *
         * Written into the shared state rather than applied while rendering,
         * so a directory revealed this way can still be closed by hand — a
         * render-time override would spring back open under the pointer.
         */
        reveal: (path, self = false) => {
          if (path === undefined) return
          const open = { ...state.open }
          const segments = path.split('/').filter(Boolean)
          const depth = self ? segments.length : segments.length - 1
          let changed = false
          for (let i = 1; i <= depth; i += 1) {
            const ancestor = `/${segments.slice(0, i).join('/')}`
            if (open[ancestor] !== true) { open[ancestor] = true; changed = true }
          }
          // `at` is written whether or not anything opened, and it is written
          // as a NEW object each time so that asking twice for the same
          // directory still moves the tree to it. Without that, a second click
          // on the same crumb is a click that does nothing.
          if (self) put({ open, at: { path } })
          else if (changed) put({ open })
        },
        setFilter: (filter) => put({ filter }),
        openMenu: (menu) => put({ menu }),
        closeMenu: () => put({ menu: undefined }),
        ask: (ask) => put({ menu: undefined, ask }),
        answered: () => put({ ask: undefined }),
      }
    })()

    /** @returns {object} the tree's shared state. */
    const useTree = () => React.useSyncExternalStore(treeStore.subscribe, treeStore.read)

    /**
     * How often the panel re-asks when there is no watch at all.
     *
     * The only timer left in the browser, and it runs only when the gateway
     * has said no watch is possible. While one IS running, the panel holds no
     * timer of its own: inotify can miss things — the kernel queue overflows,
     * and a write through another sandbox's mount is never seen — but noticing
     * that is the SANDBOX's job now. It sweeps its own directories and says
     * `stale` when they moved without an event, so a browser that has nothing
     * to do does nothing, and the gateway is not asked on a schedule by every
     * open tab.
     */
    const STALE_INTERVAL_MS = 5000

    /**
     * The workspace's own changes, as they happen.
     *
     * One subscription for the whole panel, opened when it mounts. What it
     * replaced is worth naming: the tree used to re-read a directory whenever
     * it was drawn, and the canvas asked every two seconds which page was
     * newest. Both were asking constantly for news that can be volunteered, so
     * a file that changes now reaches the panel in the time it takes to
     * travel.
     *
     * Events arrive quickly and are allowed to be incomplete — inotify drops
     * things. What makes that safe is a sweep, and the sweep runs in the
     * sandbox beside the watcher rather than here: it reports `stale` when the
     * workspace moved without an event, and the panel re-reads then. So this
     * subscription is the only thing the panel runs, and it is idle whenever
     * the workspace is.
     *
     * Listeners register by name so the tree and the canvas can each take what
     * they need without knowing about the other.
     */

    const workspaceWatch = (() => {
      const listeners = new Set()
      let source
      let timer

      /**
       * Tell everyone something happened.
       * @param {object} change - what changed, or a stale marker.
       */
      const announce = (change) => { for (const listener of listeners) listener(change) }

      /**
       * Go back to asking, because nothing is going to tell us.
       *
       * envd cannot watch a network filesystem, and a tenant's workspace is
       * one wherever it is a volume — so in production there are no events to
       * wait for, and a panel that only waits shows a directory that was made
       * five minutes ago as still absent.
       *
       * What is sent is `stale`, not a path: this knows only that the
       * workspace may have moved on, never what moved. Subscribers re-read
       * whatever they are showing.
       */
      /**
       * Look again every so often, whatever the watch is doing.
       *
       * What is sent is `stale`, not a path: this knows only that the
       * workspace may have moved on, never what moved. Subscribers re-read
       * whatever they are showing.
       *
       * @param {number} every - milliseconds between looks.
       */
      const keepAsking = (every) => {
        if (timer !== undefined) window.clearInterval(timer)
        timer = window.setInterval(() => { announce({ stale: true, path: ROOT }) }, every)
      }

      const start = () => {
        if (source !== undefined) return
        source = new EventSource('/sandbox/watch')
        source.addEventListener('message', (event) => {
          let change
          try { change = JSON.parse(event.data) } catch { return }
          // The gateway says so down the stream rather than closing it, so
          // that the browser does not reconnect to a watch that cannot exist.
          // This is the one case that puts a timer back in the browser.
          if (change.watching === false) { keepAsking(STALE_INTERVAL_MS); return }
          // The sandbox swept its own directories and found them moved without
          // an event to match. It does not know what moved, only that
          // something did.
          if (change.stale === true) { announce({ stale: true, path: ROOT }); return }
          const path = `${ROOT}/${String(change.name ?? '')}`
          announce({ ...change, path })
        })
      }

      return {
        /**
         * Hear about changes.
         * @param {(change: {name?: string, type?: string, path: string, stale?: boolean}) => void} listener - called per change.
         * @returns {() => void} stop listening.
         */
        subscribe: (listener) => {
          listeners.add(listener)
          start()
          return () => {
            listeners.delete(listener)
            if (listeners.size > 0) return
            source?.close()
            source = undefined
            if (timer !== undefined) {
              window.clearInterval(timer)
              timer = undefined
            }
          }
        },
        /**
         * Look again, now, because a person asked.
         *
         * The same signal the fallback sends on a timer, which is why one
         * control refreshes the tree and the canvas together: neither is being
         * told what changed in either case.
         */
        refresh: () => { announce({ stale: true, path: ROOT }) },
      }
    })()

    /**
     * Wide enough for two columns, because that is what the panel now is.
     *
     * 420 was right when a tab held one thing. With the tree keeping its place
     * beside the file, that left the file about 220px — narrow enough to wrap
     * a line of Python twice. The floor rises for the same reason: below this
     * the two panes stop being two panes.
     */
    const DEFAULT_WIDTH = 680
    const MIN_WIDTH = 480
    /** Ceiling as a fraction of the window, so the conversation keeps a column. */
    const MAX_FRACTION = 0.6

    /**
     * The panel's styles.
     *
     * Token-driven throughout: every colour is a `--dsw-alias-*` the theme
     * declares on `body`, so both schemes and every skin follow without this
     * file knowing any of them. The fallbacks after each token are for the
     * moment before the theme has applied, not for a theme that lacks it —
     * all of these were checked against a running deployment.
     *
     * One token is deliberately absent: `--dsw-specific-sidebar-fill`. It
     * belongs to the shell's left navigation column, and skins override it
     * with that meaning — one sets it to `transparent` — so a panel built on
     * it loses its fill. The general card surface is `--dsw-alias-bg-layer-1`.
     */
    const CSS = `
      .${NS}-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        /* The same surface the tenant's own sidebar paints, layered over ours
           rather than swapped for it.
           
           The two columns bracket the window and read as a pair, so they
           should be one colour — and the left one is painted with
           --dsw-specific-sidebar-fill, which this panel is warned off using:
           it belongs to the host's navigation column, and some skins set it to
           transparent, which would leave a panel built on it with no fill at
           all. A plain fallback cannot save that: transparent is a value and
           not an absence, so the second argument of var() is never reached.
           
           Layering answers both. The colour underneath is ours; the sidebar's
           fill is painted over it as a flat image. Where a skin gives that
           token a colour or a glass, the panel matches the sidebar exactly.
           Where a skin makes it transparent, what shows through is our own
           surface — which is what the panel looked like before. */
        background-color: var(--dsw-alias-bg-layer-1);
        background-image: linear-gradient(
          var(--dsw-specific-sidebar-fill, transparent),
          var(--dsw-specific-sidebar-fill, transparent)
        );
        border-left: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
        /* Under the shell's own floating stack, which sits at 100 and above,
           so every dialog and popover of the app covers the panel rather than
           fighting it. */
        z-index: 40;
      }

      /* The drag target, straddling the panel's left edge. Wider than the
         border it grabs, because a 1px target is a target nobody hits. */
      .${NS}-grip {
        position: absolute;
        top: 0;
        left: -3px;
        width: 7px;
        height: 100%;
        cursor: col-resize;
        touch-action: none;
        background: transparent;
        z-index: 1;
      }
      .${NS}-grip:hover,
      body[${DRAGGING}] .${NS}-grip {
        background: var(--dsw-alias-border-l2);
      }

      .${NS}-tabbar {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: none;
        position: relative;
        /* Floored, and the floor is the point. This row holds the only controls
           that close or widen the panel, so it may never be shorter than they
           are — whatever the header it is matching happens to measure. Matching
           is a nicety; being reachable is not. */
        height: max(var(${HEADER_HEIGHT_VAR}, 49px), 40px);
        /* 12px on the right — the same inset the session header gives the very
           same button when the panel is closed, and the same the filter box
           below gets. This control moves between two containers as the panel
           opens and closes, so any disagreement between their right edges is a
           jump the eye reads as the button twitching. It was 12 there and 8
           here. */
        padding: 0 12px 0 6px;
        box-sizing: border-box;
        /* Transparent, and load-bearing: it reproduces the host header's box
           so the rule below lands on the same pixel row. */
        border-bottom: 1px solid transparent;
      }

      /* The rule across the top of the panel, drawn the way the host draws
         the one across the top of the conversation — as an absolutely placed
         1px bar inset from the bottom border, not as the border itself.
         
         Copying the recipe rather than approximating it is the point. The
         first version used \`border-bottom\` with the l1 token, which put the
         line two pixels lower and one shade lighter than the host's: two
         rules across the top of the window that almost agreed, which reads
         worse than either alone. The host's is \`header::after\` at
         \`bottom: 1px\` over l2, and with the tab bar already matching the
         header's measured height, the same recipe puts them on one line. */
      .${NS}-tabbar[data-empty]::after {
        display: none;
      }
      .${NS}-tabbar::after {
        content: '';
        position: absolute;
        right: 0;
        bottom: 1px;
        left: 0;
        z-index: 0;
        height: 1px;
        background: var(--dsw-alias-border-l2);
        pointer-events: none;
      }

      /* The tabs scroll; the trailing controls do not.

         The shrink-only flex and the zero min-width together are what keeps
         the last tab and the control that opens the next one whole: the strip
         shrinks and scrolls instead of pushing them out of the panel, and it
         sits against them rather than spanning the row. Without the zero
         min-width a flex item refuses to shrink below its content, and the row
         overflows with the plus beyond the panel's edge. */
      .${NS}-tabs {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 0 1 auto;
        min-width: 0;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        /* Deliberately NOT smooth. Smooth turns an assignment to the scroll
           offset into an animation, so the value read back is the one it
           started from and any re-render before it lands cancels it — which is
           how a strip that had been told to show the new tab kept showing the
           old one. */
        scrollbar-width: none;
      }
      .${NS}-tabs::-webkit-scrollbar { display: none; }

      /* A tab is as wide as its own name, up to a ceiling.

         Not one width for all of them, and not a width the row divides among
         them. Both were tried here and both make a tab's width a function of
         the OTHER tabs: under the shared-width rule, opening a seventh file
         moved the six already open — every one of them narrowed, so the tab
         somebody was about to click was no longer where they were looking. A
         width that follows the name is stable under everything except renaming
         the file, and the row is read left to right rather than measured.

         The ceiling is what keeps one long name from taking the row: past
         132px the name fades out (see the label below) instead of pushing its
         neighbours off the end. There is no floor. A short name gets a short
         tab, which is the whole of this rule, and the label's own right-hand
         padding is what stops the close key landing on the last letter of one.

         Past the row's width the strip scrolls — by wheel, by drag, and by
         itself when the tab in play is off the end. Scrolling is the honest
         answer to more tabs than fit: it hides some of them completely, which
         is at least visible, while narrowing hides a piece of every name at
         once and reads as though nothing was lost. */
      .${NS}-tab {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: none;
        max-width: 132px;
        height: 30px;
        padding: 0 8px;
        box-sizing: border-box;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-family: var(--dsw-font-family);
        font-size: 13px;
        line-height: 20px;
        cursor: pointer;
        white-space: nowrap;
      }
      .${NS}-tab:hover {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }
      /* The showing tab, told apart by its ground.

         \`button-ghost-active-fill\` is the token for a pressed ghost button —
         a state that lasts as long as a finger is down, so it is a whisper by
         design, and one shade off the panel's own surface. Held for as long as
         a tab is open it was not a state anyone could see: measured in the
         running panel it was 1.12:1 against the panel's surface in the light
         theme, and 1.005:1 against the HOVER fill. The tab that was open and
         whatever tab the pointer happened to be over were the same colour to
         three decimal places.

         One step of an interactive fill is not enough on its own — every one
         the theme publishes is a thin tint meant for a state that lasts a
         moment, and this state lasts as long as the file is open. So two are
         laid over each other: the held-interactive fill as the colour, and the
         panel's own division token painted over it as a flat image. Both are
         translucent, so the ground lands about twice as far from the surface
         as either reaches alone — a visible step in both schemes, and still a
         neutral one, which is what a row of six of them needs.

         Layered rather than outlined, and that is the requirement rather than
         a preference: a ring says "focused", the eye reads it as the thing it
         is about to act on rather than the thing it is looking at, and it
         draws a second edge inside a row that already has the rule under it.
         The ground is what a tab IS.

         The ground and the label colour, and nothing else. A heavier weight
         was here too and had to go once a tab took its width from its name:
         500 measures wider than 400, so selecting a tab widened it and pushed
         every tab to its right along by a couple of pixels — a row that
         twitches under the pointer that just clicked it. The ground says the
         same thing and costs no width. */
      .${NS}-tab[aria-selected='true'] {
        background-color: var(--dsw-alias-interactive-bg-active);
        background-image: linear-gradient(
          var(--dsw-alias-border-l2),
          var(--dsw-alias-border-l2)
        );
        color: var(--dsw-alias-label-primary);
      }
      /* Pushes the closing control to the panel's own edge. */
      .${NS}-spacer {
        flex: 1 1 auto;
      }
      .${NS}-tab-icon {
        display: inline-flex;
        flex: none;
        color: var(--dsw-alias-label-tertiary);
      }
      .${NS}-tab[aria-selected='true'] .${NS}-tab-icon {
        color: var(--dsw-alias-label-primary);
      }
      /* A name that does not fit fades out; it is not cut with an ellipsis.

         An ellipsis costs three characters to say "there is more", and at the
         widths this row reaches that is most of the name — \`m…\` says nothing
         at all, while three more letters of \`main.py\` often say everything.
         The fade carries the same "there is more" for free, and it is honest
         about it: the reader sees the letters running out rather than a mark
         standing in for them.

         Masked rather than drawn as a gradient over the top, because a
         gradient would need to know the ground it sits on — and the ground
         here is three different colours (idle, hovered, showing) over two
         themes. A mask makes the TEXT transparent instead, so whatever is
         behind it shows through unchanged.

         The mask is on the box, not on the text, so a name shorter than its
         box is untouched: the fade lands where there is nothing to fade. */
      .${NS}-tab-label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        /* The gutter is what makes one fade correct for both cases, with no
           measuring and no second rule for the pointer.

           A name that fits ends 14px before the box does, so the fade has only
           empty ground to work on and the name is drawn whole — and that same
           14px is where the close key sits, so it appears over the gutter
           rather than over the last letter. A name that does not fit is
           scrolled under its own gutter: the padding goes past the clipping
           edge, the letters reach the fade, and the tail dissolves exactly
           where the key will be. */
        padding-right: 14px;
        -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent);
        mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent);
      }

      /* The close key appears under the pointer rather than on the selected
         tab, and it is LAID OVER the name rather than given a column of its
         own.

         Its own column was 16px and it held them whether or not anything was
         drawn in it — on a short tab, most of the room the name had, spent on
         empty space for the tab the pointer is not on. Out of the flow it
         costs nothing until it is wanted, and it lands on the label's gutter:
         empty ground when the name fits, and the tail the fade has already
         given up when it does not. */
      .${NS}-tab-close {
        position: absolute;
        top: 50%;
        right: 6px;
        margin-top: -8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        opacity: 0;
        border: none;
        border-radius: 4px;
        padding: 0;
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
        cursor: pointer;
      }
      .${NS}-tab:hover .${NS}-tab-close,
      .${NS}-tab-close:focus-visible {
        opacity: 1;
      }
      .${NS}-tab-close:hover {
        background: var(--dsw-alias-border-l2);
        color: var(--dsw-alias-label-primary);
      }

      /* A control that asks for something again, turning once as it asks.

         Half a second and one turn, on the gesture rather than on the work:
         what these two buttons start — a directory listing, an iframe's own
         fetch — usually settles faster than the eye can register a spinner
         appearing and going, and tying the turn to the work would mean the
         common case is a flicker. The turn is the acknowledgement; the result
         arriving is its own answer.

         On the glyph, not on the button: the button is a hover target with a
         ground, and turning that turns the ground with it. */
      @keyframes ${NS}-turn {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .${NS}-icon-button[data-turning] > * {
        animation: ${NS}-turn 500ms var(--ds-ease-in-out, ease-in-out);
      }
      @media (prefers-reduced-motion: reduce) {
        .${NS}-icon-button[data-turning] > * { animation: none; }
      }

      /* The shell draws an icon control as a round ghost, and the panel's sit
         in the same rows as the shell's. A squarer corner here read as a
         different kind of control rather than the same one. */
      .${NS}-icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 50%;
        padding: 0;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .${NS}-icon-button:hover {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }

      .${NS}-body {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
      }
      /* Markdown carries its own type and spacing from the shell's own
         component; all this adds is the room around it. */
      .${NS}-markdown {
        padding: 14px 16px;
      }

      /* The code view fills the pane instead of sitting in it.
      
         The shell's CodeBlock draws a card — surface, border, radius, and a
         header carrying the language and a copy button. That is right inside a
         message, where a code block is one thing among many; it is wrong as a
         whole view, where it becomes a card drawn inside a pane that already
         has edges, with its own copy button competing with the row of actions
         above it. The highlighting is what we came for, so the card is undrawn
         and the copy moved up to the path row where the other actions are. */
      .${NS}-code {
        min-height: 100%;
      }
      .${NS}-code > * {
        height: 100%;
        margin: 0;
        border: none;
        border-radius: 0;
        background: transparent;
      }
      /* The card's header row: the language name and its own copy button. */
      .${NS}-code > * > *:first-child {
        display: none;
      }
      .${NS}-code pre {
        margin: 0;
        padding: 12px 14px;
        background: transparent;
      }

      /* The empty state. The panel opens with no tabs, so this is the first
         thing anyone sees — it lists what can be opened rather than showing a
         blank surface with a `+` somewhere in a corner. */
      /* Nothing but the cards, centred in the panel.
         
         The row above them said "Open a tool" over three cards that are each
         a tool with its name on it — a caption for a picture of itself. What
         is left is the choice, and with the caption gone there is no reading
         order to anchor to the left edge: the cards centre, in both axes, in
         the space the panel is not otherwise using. */
      .${NS}-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 24px;
        box-sizing: border-box;
      }
      /* Two cards to a row, each the size of what is in it.

         Two columns stated rather than a floor that fits as many as it can:
         the panel is a column beside a conversation, and a row of three across
         it read as a toolbar rather than as a choice between three things. The
         columns are a width, not a fraction, so the cards stay the size the
         content wants at every panel width instead of stretching into
         whatever room the panel happens to have — a 400px-wide card holding an
         icon and one word is a card that has lost track of what it is for.

         Centred, which is where a choice with no caption over it belongs —
         and because the cards are a width rather than a fraction, centring
         moves them as a block instead of growing each one to swallow the
         space. */
      /* Two fixed columns, and the pair of them centred in the panel.
         
         Centring the BLOCK, not each line: a wrapped flex row centres its last
         line too, which put a third card under the middle of the two above it
         — a little pyramid, and a reading order that starts in a different
         place on every row. A grid seats the odd card in the first column, so
         the left edge of the group is a line all the way down. */
      .${NS}-choices {
        display: grid;
        grid-template-columns: repeat(2, 124px);
        justify-content: center;
        gap: 8px;
      }
      /* Two rows, centred on each other: the mark, then the name. The
         sentence that used to sit under the name has moved to the card's
         title — three lines of prose in a card the size of a stamp is a
         paragraph with a border, and what the tool does is answered by
         opening it. */
      .${NS}-choice {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 124px;
        gap: 8px;
        /* Deeper above and below than to either side. The card is two short
           rows stacked, and even padding around them reads as a label with a
           box drawn tight to it; the air is what makes it a card. */
        padding: 18px 12px;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
        font-size: 13px;
        line-height: 20px;
        text-align: center;
        cursor: pointer;
      }
      .${NS}-choice:hover {
        background: var(--dsw-alias-interactive-bg-hover);
        border-color: var(--dsw-alias-border-l2);
      }
      .${NS}-choice-icon {
        display: inline-flex;
        flex: none;
        color: var(--dsw-alias-label-secondary);
      }
      .${NS}-choice-note {
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
        line-height: 16px;
      }

      /* The side column's own heading row, and the strip it folds into. */
      .${NS}-aside-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex: none;
        height: 32px;
        padding: 0 6px 0 12px;
        box-sizing: border-box;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .${NS}-aside-title {
        color: var(--dsw-alias-label-tertiary);
        font-family: var(--dsw-font-family);
        font-size: 12px;
      }
      /* One shell's screen. All of them are laid out; only one is shown. */
      .${NS}-console-slot {
        height: 100%;
      }

      /* The terminal fills its tab; xterm draws inside it. */
      .${NS}-console {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 8px 0 0 10px;
        box-sizing: border-box;
        background: var(--dsw-alias-bg-layer-1);
      }
      .${NS}-console-screen {
        flex: 1 1 auto;
        min-height: 0;
      }
      .${NS}-console-note {
        flex: none;
        padding: 8px 10px;
        color: var(--dsw-alias-label-tertiary);
        font-family: var(--dsw-font-family);
        font-size: 12px;
      }

      /* The row menu and the questions it leads to. Both are drawn at the
         panel's level rather than inside the column a row lives in, so neither
         is clipped by that column's scrolling. */
      .${NS}-menu {
        position: fixed;
        z-index: 41;
        min-width: 148px;
        padding: 4px;
        border-radius: 10px;
        background: var(--dsw-alias-button-elevated-fill);
        box-shadow: var(--dsw-shadow-lv2);
      }
      .${NS}-menu-item {
        display: block;
        width: 100%;
        padding: 7px 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
        font-size: 13px;
        line-height: 18px;
        text-align: left;
        cursor: pointer;
      }
      /* A menu row that carries a mark, for the menu the `+` opens: the same
         row as the tree's, plus the icon that names the tool in the tab bar —
         two ways of saying the same tool, so the menu and the tab it produces
         look like each other.

         Stated as a compound selector and placed AFTER the plain row, both on
         purpose. A row is \`display: block\` and this one has to be a flex
         line; at equal specificity the later rule wins, so written above with
         one class it lost its display to the very rule it was extending —
         the icon and the name ran together on the baseline with no gap and no
         centring, which is exactly what a block box does with two inline
         children. */
      .${NS}-menu-item.${NS}-menu-tool {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .${NS}-menu-tool > span:first-child {
        display: inline-flex;
        flex: none;
        align-items: center;
        color: var(--dsw-alias-label-tertiary);
      }
      .${NS}-menu-item:hover {
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .${NS}-menu-item[data-danger] {
        color: var(--dsw-alias-state-error-primary);
      }
      .${NS}-menu-item[data-danger]:hover {
        background: var(--dsw-alias-interactive-bg-hover-danger);
      }
      .${NS}-menu-sep {
        height: 1px;
        margin: 4px 6px;
        background: var(--dsw-alias-border-l1);
      }

      .${NS}-mask {
        position: fixed;
        inset: 0;
        z-index: 42;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--dsw-alias-bg-mask-1);
      }
      .${NS}-dialog {
        width: min(380px, calc(100vw - 32px));
        padding: 18px 20px 14px;
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: var(--dsw-shadow-lv3);
      }
      .${NS}-dialog-title {
        margin-bottom: 10px;
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
        font-size: 15px;
        font-weight: 500;
      }
      .${NS}-dialog-body {
        color: var(--dsw-alias-label-secondary);
        font-family: var(--dsw-font-family);
        font-size: 13px;
        line-height: 20px;
      }
      .${NS}-dialog-input {
        width: 100%;
        height: 34px;
        padding: 0 10px;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
        font-size: 13px;
      }
      .${NS}-dialog-input:focus {
        outline: none;
        border-color: var(--dsw-alias-state-business-primary);
      }
      .${NS}-dialog-note {
        margin-top: 8px;
        color: var(--dsw-alias-label-tertiary);
        font-family: var(--dsw-font-family);
        font-size: 12px;
        line-height: 18px;
      }
      .${NS}-dialog-note[data-danger] {
        color: var(--dsw-alias-state-error-primary);
      }
      .${NS}-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }
      .${NS}-dialog-button {
        height: 32px;
        padding: 0 14px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 10px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
        font-size: 13px;
        cursor: pointer;
      }
      .${NS}-dialog-button:hover {
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .${NS}-dialog-button[data-primary] {
        border-color: transparent;
        background: var(--dsw-alias-button-primary-fill);
        color: var(--dsw-alias-label-primary-foreground);
      }
      .${NS}-dialog-button[data-primary][data-danger] {
        background: var(--dsw-alias-state-error-primary);
        /* White in BOTH themes, stated rather than inherited. The token
           label-primary-foreground is not "white": it is whatever contrasts
           with the PRIMARY fill, and that fill flips with the theme — so it is
           white in one and black in the other. The error fill does NOT flip;
           it is red either way. Inheriting the one from the other put black
           text on a red button, in whichever theme the primary button is
           light. */
        color: var(--dsw-static-neutral-bluish-00, #fff);
      }
      .${NS}-dialog-button:disabled {
        opacity: .55;
        cursor: default;
      }

      /* A file tab: the path and what can be done with it on one row, then
         the file beside the tree it was chosen from. */
      .${NS}-file {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .${NS}-crumbs {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
        height: 36px;
        /* 12px on the right, the same as the bar above. The fold control here
           sits directly under the panel's own toggle, and 8 against 12 put
           their centres four pixels apart — close enough to read as a mistake
           rather than as two levels of one thing. */
        padding: 0 12px;
        box-sizing: border-box;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      /* The path, as places rather than as text. It scrolls rather than
         truncating: every level is a target, so hiding one would take away
         somewhere to go. */
      .${NS}-crumb-path {
        display: flex;
        align-items: center;
        flex: 1 1 auto;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
        font-size: 12px;
        line-height: 18px;
        white-space: nowrap;
      }
      .${NS}-crumb-path::-webkit-scrollbar { display: none; }
      .${NS}-crumb {
        flex: none;
        padding: 2px 4px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
        font-family: var(--dsw-font-family);
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
      }
      .${NS}-crumb:hover {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }
      .${NS}-crumb-sep {
        flex: none;
        color: var(--dsw-alias-label-tertiary);
      }
      .${NS}-crumb-name {
        flex: none;
        padding: 2px 4px;
        color: var(--dsw-alias-label-primary);
      }

      /* The two-position switch a markdown file gets. Segmented rather than a
         pair of buttons, for the same reason the host's own view switch is. */
      .${NS}-segments {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        flex: none;
        height: 26px;
        padding: 2px;
        box-sizing: border-box;
        border-radius: 8px;
        background: var(--dsw-alias-button-ghost-active-fill);
      }
      .${NS}-segment {
        height: 22px;
        padding: 0 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-family: var(--dsw-font-family);
        font-size: 12px;
        line-height: 22px;
        cursor: pointer;
      }
      .${NS}-segment[aria-pressed='true'] {
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        box-shadow: var(--dsw-shadow-lv1);
      }

      /* The file, and the tree it came from. The tree keeps its place when a
         file is opened — choosing one file is usually the prelude to choosing
         the next, and a tree that closes on every choice has to be reopened
         before every choice. */
      .${NS}-split {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
      }
      .${NS}-split-main {
        flex: 1 1 auto;
        min-width: 0;
        overflow: auto;
      }
      .${NS}-split-aside {
        display: flex;
        flex-direction: column;
        flex: none;
        width: 200px;
        min-height: 0;
        border-left: 1px solid var(--dsw-alias-border-l1);
      }

      /* Filtering, not searching: it narrows the rows already loaded rather
         than asking the sandbox to walk the workspace. The wording says so. */
      .${NS}-filter {
        flex: none;
        /* 12 on the right for the same reason as the bar above it: everything
           that ends at the panel's edge ends at the same place. */
        padding: 8px 12px 8px 8px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .${NS}-filter input {
        width: 100%;
        height: 28px;
        padding: 0 10px;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
        font-size: 12px;
      }
      .${NS}-filter input::placeholder {
        color: var(--dsw-alias-label-tertiary);
      }
      .${NS}-filter input:focus {
        outline: none;
        border-color: var(--dsw-alias-state-business-primary);
      }
      .${NS}-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
      }

      /* The tree. Rows are buttons so they answer to the keyboard without
         anything here reimplementing what a button already does. */
      .${NS}-tree {
        padding: 6px 0;
      }
      /* A row is a card with room around it, not a band across the column.
         Full-bleed selection reads as a highlight of the panel; an inset
         rounded rectangle reads as a selection of the thing. */
      .${NS}-row {
        display: flex;
        align-items: center;
        /* A little more air than the 6px this was: a mark and the name it
           belongs to should read as two things, and at 6px an icon and a
           lowercase letter of the same weight ran together into one shape. */
        gap: 8px;
        height: 28px;
        margin: 0 6px;
        padding-right: 6px;
        border-radius: 8px;
        box-sizing: border-box;
        border: none;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
        font-size: 13px;
        line-height: 28px;
        text-align: left;
        cursor: pointer;
      }
      .${NS}-row:hover,
      .${NS}-row:focus-visible {
        background: var(--dsw-alias-interactive-bg-hover);
        outline: none;
      }
      .${NS}-row[aria-current='true'] {
        background: var(--dsw-alias-button-ghost-active-fill);
      }
      .${NS}-row-twisty {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 12px;
        color: var(--dsw-alias-label-tertiary);
        transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out);
      }
      .${NS}-row-icon {
        display: inline-flex;
        flex: none;
        color: var(--dsw-alias-label-tertiary);
      }
      .${NS}-row-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      /* Shown under the pointer, like the tabs' close key and for the same
         reason: a row that always carried two buttons would be a row of
         buttons with a name in it. */
      .${NS}-row-menu {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        flex: none;
        opacity: 0;
      }
      .${NS}-row:hover .${NS}-row-menu,
      .${NS}-row-menu:focus-within {
        opacity: 1;
      }
      .${NS}-row-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
        cursor: pointer;
      }
      .${NS}-row-action:hover {
        background: var(--dsw-alias-border-l2);
        color: var(--dsw-alias-label-primary);
      }
      /* Loading, empty and failed all read as one quiet line in the tree
         rather than as three different shapes. */
      .${NS}-tree-note {
        padding: 4px 10px;
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        line-height: 20px;
      }

      /* A file's own bytes, in the three shapes they come in. */
      .${NS}-text {
        margin: 0;
        padding: 12px 14px;
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family-code, ui-monospace, monospace);
        font-size: 12px;
        line-height: 20px;
        white-space: pre;
        /* The pane scrolls in both directions rather than wrapping: a wrapped
           line in a code file is a line that has moved. */
        overflow: auto;
      }
      .${NS}-media {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        padding: 16px;
        box-sizing: border-box;
      }
      .${NS}-image {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .${NS}-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: none;
        /* The previewed page paints its own background; without this a
           transparent one shows the panel through it. */
        background: #fff;
      }

      /* What is left when the panel's own render throws. It borrows the
         placeholder's shape rather than inventing one: this is the same
         moment — nothing to show, and a sentence saying why — and the only
         difference is that the reason is a defect rather than a wait. */
      .${NS}-crash {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 100%;
        padding: 24px;
        box-sizing: border-box;
        text-align: center;
        color: var(--dsw-alias-label-tertiary);
        font-size: 13px;
        line-height: 20px;
      }
      .${NS}-crash strong {
        color: var(--dsw-alias-state-error-primary);
        font-weight: 500;
      }

      /* Everything a body says when it has nothing to show yet: loading,
         empty, and failed alike. One look for all three, because to a person
         they are the same moment — the panel is not showing the thing asked
         for, and the sentence in the middle says why. */
      .${NS}-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 100%;
        padding: 24px;
        box-sizing: border-box;
        color: var(--dsw-alias-label-tertiary);
        font-size: 13px;
        line-height: 20px;
        text-align: center;
      }

      /* The header's utility buttons, given one shape — the rail's.
      
         There were three shapes in this row at once: the sidebar's New session
         button, Session log as a wide pill with a label, and ours as a third
         thing again. What settles it is that both of these are now icons: a
         word on one of two adjacent icon buttons is the odd thing in the row,
         and once the word goes there is nothing left for a pill to hold. So
         both take the shape of the collapse control at the other end of the
         window — a 28px circular ghost, no border, no fill until the pointer
         arrives. Restated from the sidebar's own icon-button rule rather than
         borrowed, since its class is a content hash.
         
         The rule is anchored on the slot both are rendered into, so it styles
         what that seat holds rather than reaching into a component: a Session
         log that moves or goes away takes its own look with it and nothing
         here is left pointing at a hole. */
      [data-slot='conversation.session.header.utilities'] button,
      .${NS}-opener,
      .${NS}-toggle {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        min-width: 0;
        height: 28px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      [data-slot='conversation.session.header.utilities'] button:hover,
      .${NS}-opener:hover,
      .${NS}-toggle:hover {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }
      /* Session log's own label. Hidden rather than removed: it is upstream's
         element and upstream's copy, and it is still what a screen reader
         reads out, which display:none or visibility:hidden would take away. */
      [data-slot='conversation.session.header.utilities'] button > span:first-child {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      /* Pressed is a state of the control, not a second control: the same
         button says the panel is open rather than turning into a different
         one. */
      .${NS}-toggle[aria-pressed='true'] {
        background: var(--dsw-alias-interactive-bg-active);
        color: var(--dsw-alias-label-primary);
      }

      /* The stand-in for the toggle before a session exists, when there is no
         header to sit in. The corner is empty in that state; once a session
         opens this is not rendered at all, so it can never overlap the
         header's own controls.
         
         It carries no look of its own — it is in the rule above, alongside the
         control it stands in for, and everything here is about WHERE it sits.
         It used to be a 32px bordered rectangle while the control it replaces
         is a 28px circle, so opening the panel moved the button two pixels
         left and two pixels up and changed its shape on the way. It is one
         control in a person's hands, and the eye reads the difference as the
         button jumping rather than as two buttons. */
      .${NS}-opener {
        position: fixed;
        /* Level with the panel header's own row, so the button does not rise
           or fall as the panel opens under it. */
        top: 10px;
        /* Clear of the panel when it is open, which is why the width is a
           variable on the document rather than a number in the component. */
        right: calc(var(${WIDTH_VAR}, 0px) + 12px);
        transition: right var(--ds-transition-duration-slow) var(--ds-ease-in-out);
        z-index: 40;
      }
      .${NS}-opener[aria-pressed='true'] {
        color: var(--dsw-alias-label-primary);
      }
      body[${DRAGGING}] .${NS}-opener {
        transition: none;
      }

      /* ---- the host's own header, rearranged -------------------------------
         A different kind of work from everything above: this is surgery on a
         component we do not own, so it is written to fail by doing nothing.

         Every rule hangs off \`MERGED_HEADER\`, whose guard describes the
         structure it expects; see it for what happens when upstream's does not
         match. Nothing here can leave a button orphaned or stacked on another.

         No class names are involved. They are content hashes and change
         between builds; \`role="tab"\` and \`aria-selected\` are the contract
         the component already publishes, and they say precisely what is
         needed.

         What it does: the view switch stops occupying a row of its own and
         joins the title row as a segmented control, which is what gives that
         vertical space back to the conversation. */
      ${MERGED_HEADER} {
        display: grid;
        /* The switch belongs beside what it switches, so it sits directly
           after the title cluster and the free space falls between it and the
           utilities — rather than the title taking the slack and pushing the
           switch across the window. */
        grid-template-columns: minmax(0, auto) auto minmax(0, 1fr) auto;
        align-items: center;
        column-gap: 12px;
        /* Upstream pads 12px above the title row and leaves the bottom to the
           row that has now gone. With one row instead of two the header was
           still carrying two rows' worth of air, so both edges come in — this
           is the whole of the height the merge was for. */
        padding-top: 8px;
        padding-bottom: 8px;
        /* Upstream insets the right edge 28px, sized for the bordered pill
           that used to end the row. The row now ends in a 28px ghost circle,
           which carries far less visual weight and read as marooned that far
           in — the same inset that framed a pill strands a circle. */
        padding-right: 12px;
      }

      /* Dissolved, not moved: \`display: contents\` lets the title row's two
         clusters become items of the header's grid so the switch can sit
         between them. The row carries no padding of its own — the header
         does — so nothing is lost with the box. */
      ${MERGED_HEADER} > div:first-child {
        display: contents;
      }
      ${MERGED_HEADER} > div:first-child > div:first-child {
        grid-column: 1;
        grid-row: 1;
        min-width: 0;
      }
      ${MERGED_HEADER} > div:first-child > div:nth-child(2) {
        grid-column: 4;
        grid-row: 1;
      }

      ${MERGED_HEADER} > div:nth-child(2) {
        /* Row stated as well as column: with only the column pinned, grid's
           sparse auto-placement finds the cursor already past column 2 and
           drops the switch onto a second row — the exact row this block
           exists to remove. */
        grid-column: 2;
        grid-row: 1;
        gap: 2px;
        height: 32px;
        margin: 0;
        padding: 3px;
        box-sizing: border-box;
        border-radius: 10px;
        background: var(--dsw-alias-button-ghost-active-fill);
        align-items: center;
      }
      /* Shape only. The switch's own type and colours — tertiary when idle,
         the business accent when active — are upstream's and stay upstream's;
         restating them here would be a second copy to keep true. */
      ${MERGED_HEADER} > div:nth-child(2) > [role='tab'] {
        height: 26px;
        padding: 0 14px;
        border-radius: 8px;
        line-height: 26px;
      }
      /* Whatever upstream draws under the active tab belongs to the row it no
         longer sits in. */
      ${MERGED_HEADER} > div:nth-child(2) > [role='tab']::after,
      ${MERGED_HEADER} > div:nth-child(2) > [role='tab']::before {
        display: none;
      }
      ${MERGED_HEADER}
        > div:nth-child(2) > [role='tab'][aria-selected='true'] {
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: var(--dsw-shadow-lv1);
      }

      /* The push: the conversation gives up the width instead of being
         covered.

         Taken off the CENTRE COLUMN, not off #root, and that is not a detail.
         The app frame watches ITS OWN box with a ResizeObserver and collapses
         the left sidebar below 1024px — so narrowing #root told the app the
         window had shrunk, and opening this panel folded the tenant's sidebar
         away. Nothing about the window changed; only our panel appeared.

         Shrinking the centre column instead leaves the frame the width it
         always had, so that decision is never disturbed, and the squeeze still
         lands where it should: the centre column is the only flexible one, so
         the conversation and its composer reflow and the sidebar does not
         move. The strip the column gives up is what the panel is drawn over.

         A margin works here where it could not on #root: this is a grid item,
         and a grid item shrinks by its margins. #root is a block at full
         width, where a right margin over-constrains the box and CSS resolves
         that by ignoring the margin outright.

         If upstream ever restructures the frame this selector stops matching,
         and the panel goes back to covering the conversation instead of
         pushing it — worse to look at, and nothing breaks. */
      html #root > [data-slot='root'] > div > div:nth-child(2) {
        margin-right: var(${WIDTH_VAR}, 0px);
        transition: margin-right var(--ds-transition-duration-slow) var(--ds-ease-in-out);
      }
      body[${DRAGGING}] #root > [data-slot='root'] > div > div:nth-child(2) {
        transition: none;
      }
      @media (prefers-reduced-motion: reduce) {
        html #root > [data-slot='root'] > div > div:nth-child(2) { transition: none; }
      }
    `

    /**
     * One inline icon, by name.
     *
     * Almost all of them are the harness's own. `ui-primitives` carries 70
     * glyphs drawn from the same source as the rest of the interface, and the
     * panel sits inside that interface — so a hand-drawn set beside it read as
     * a second product in the same window, which is what this replaced.
     *
     * The rest are in `dsh-icons`, and only because the harness set has no
     * drawing that means them: a terminal, the second half of the fullscreen
     * pair, a plain file, and the three file kinds the tree labels. They are
     * drawn to the same rules — a 16 grid, a 1.3 stroke expanded to a filled
     * outline, `currentColor`, no ink of their own.
     *
     * Both kinds render the same way here, which is the point of going through
     * one table: a name that moves from `drawn` to the harness set later is a
     * line in this table and nothing at the call sites.
     *
     * `size` is a square edge in px. It overrides whatever a glyph's own drawn
     * size is, because these sit in rows whose height the panel decides.
     *
     * @param {string} name - a key of `GLYPHS`.
     * @param {number} size - the square edge, in px.
     * @returns {object} the element.
     */
    /**
     * Turn a control once, now.
     *
     * The attribute is taken off and put back with a forced reflow between,
     * because setting an attribute that is already there restarts nothing:
     * pressing refresh twice in a row would turn the glyph once. Reading
     * `offsetWidth` is what makes the removal land as its own style pass.
     *
     * @param {Element} button - the control that was pressed.
     */
    const turn = (button) => {
      button.removeAttribute('data-turning')
      void /** @type {HTMLElement} */ (button).offsetWidth
      button.setAttribute('data-turning', '')
    }

    const icon = (name, size = 16) => {
      const glyph = GLYPHS[name]
      if (glyph === undefined) return undefined
      // A harness glyph is a component; ours is path data. The shell's set is
      // the one that can go missing — `primitives` is `{}` when the module
      // table does not carry it — and a missing icon must not take the render
      // down, so this answers with nothing rather than throwing.
      // On the glyph itself, not on a wrapper around it. A wrapper is one more
      // box in a row whose buttons size themselves from their contents, and it
      // is the kind of change that fails by making something disappear. Passed
      // as a style, so a component that does not forward props loses the flip
      // and keeps the icon — the failure worth having, of the two.
      if (typeof glyph === 'function') return h(glyph, { size })
      // Painted the way it was drawn. The harness's glyphs are outlines already
      // expanded to filled shapes; the extracted half is strokes, and filling a
      // stroke turns a drawing into a blot.
      const paint = glyph.stroke === undefined
        ? { fill: 'currentColor', fillRule: 'evenodd' }
        : {
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: glyph.stroke.width,
            strokeLinecap: glyph.stroke.linecap,
            strokeLinejoin: glyph.stroke.linejoin,
          }
      return h('svg', {
        width: size,
        height: size,
        viewBox: glyph.viewBox,
        fill: 'none',
        'aria-hidden': true,
      }, ...glyph.paths.map((d, at) => h('path', { key: at, d, transform: glyph.transform, ...paint })))
    }

    /**
     * Every glyph the panel draws, as the name the call sites use for it.
     *
     * Where two names resolve to one glyph — `files` and `folder`, `browser`
     * and `html` — that is deliberate: the call sites mean different things and
     * the harness happens to draw them the same, which is a fact about the set
     * rather than something to collapse here.
     */
    const GLYPHS = {
      files: primitives.IconFolderClose16,
      // The globe, not `IconBrowseOutline16` — that one is a document with a
      // reading rule through it. An HTML file in the tree means "somewhere on
      // the web", which is what this draws. The canvas TAB used to wear it too
      // and now wears `brush`: a tool and a file that share one mark are two
      // things the eye has to tell apart by position.
      browser: primitives.IconGlobeOutline14,
      brush: extracted.brush,
      close: primitives.IconCloseOutline16,
      new: primitives.IconPlusOutline16,
      expand: primitives.IconFullscreenOutline16,
      panel: mirrored['panel-right'],
      chevron: primitives.IconChevronRightOutline14,
      more: primitives.IconEllipsisOutline16,
      code: extracted.code,
      copy: primitives.IconCopyOutline16,
      refresh: primitives.IconRefreshOutline16,
      terminal: extracted.terminal,
      shrink: extracted.shrink,
      file: extracted.file,
      image: extracted.image,
      markdown: extracted.markdown,
      'copy-text': extracted['copy-text'],
      data: extracted.data,
      archive: extracted.archive,
      table: extracted.table,
      media: extracted.media,
      aside: extracted.list,
    }

    /**
     * What the empty state offers.
     *
     * The three tools a tenant opens for themselves. This list is the active
     * half of the panel's one product rule — the passive half is files the
     * agent produced, which arrive by being clicked in the conversation and
     * are never listed here.
     */
    const TOOLS = [
      { id: 'files', icon: 'files' },
      { id: 'terminal', icon: 'terminal' },
      { id: 'canvas', icon: 'brush' },
    ]

    /**
     * Where the workspace tree is rooted.
     *
     * Must agree with `ROOT` in the gateway's `panel-path.js`, which bounds
     * every path to it — two copies of one fact, because they are on opposite
     * sides of the wire and nothing can be imported across it.
     */
    const ROOT = '/mnt/workspace'

    /**
     * Whether a path is one the tree can show.
     *
     * The panel opens anything in the sandbox; the tree lists one directory of
     * it. This is the line between those two, and the reason a file from
     * `/tmp` gets a tab and no highlighted row.
     *
     * @param {string|undefined} path - an absolute path.
     * @returns {boolean} whether the tree holds it.
     */
    const insideWorkspace = (path) => typeof path === 'string' && path.startsWith(`${ROOT}/`)

    /**
     * Ask the gateway about the tenant's workspace.
     *
     * Same origin, so the session cookie goes along without anything being
     * said about it here — the panel has no notion of this deployment's
     * tokens and does not want one.
     *
     * @param {string} path - an absolute path inside the workspace.
     * @returns {Promise<Array<object>>} the directory's entries.
     * @throws {Error} carrying whatever the gateway said, for the row to show.
     */
    const listDir = async (path) => {
      const response = await fetch(`/sandbox/fs/list?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(fromServer(say(), payload.error, 'error.read', { status: String(response.status) }))
      return payload.entries ?? []
    }

    /**
     * Whether a path is still there.
     *
     * Bytes are not asked for — the two viewers that need this are an image
     * and an HTML page, both of which have already handed their URL to the
     * browser, and downloading a file a second time to find out whether it
     * exists would cost more than what it answers.
     *
     * A 404 is the sandbox saying no such path, and nothing else answers 404
     * here: a sandbox that cannot be reached at all is a 502, so this cannot
     * mistake a deployment being down for a file being deleted.
     *
     * @param {string} path - an absolute path inside the workspace.
     * @returns {Promise<boolean>} false only when the sandbox says it is gone.
     */
    const stillThere = async (path) => {
      try {
        const response = await fetch(`/sandbox/fs/stat?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' })
        return response.status !== 404
      } catch {
        // A network that failed says nothing about the file, and a tab is not
        // closed on a question that went unanswered.
        return true
      }
    }

    /**
     * The URL one file's bytes are served at.
     *
     * Path-encoded rather than a query parameter, and the gateway decodes it
     * the same way. That is what lets an HTML preview resolve `./style.css`
     * back into this route: a path-relative reference keeps the path and drops
     * the query.
     *
     * @param {string} path - an absolute path inside the workspace.
     * @returns {string} the URL.
     */
    const rawUrl = (path) => `/sandbox/raw/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`

    /**
     * A short-lived ticket that lets an HTML preview fetch its own assets.
     *
     * The frame a preview loads in is sandboxed to an opaque origin, so its
     * requests for `./style.css` carry no session cookie and come back 401.
     * The ticket rides in the URL path ahead of the file, which is what makes
     * a relative reference resolve to a URL that is still authenticated.
     *
     * @returns {Promise<string>} the ticket.
     */
    const mintTicket = async () => {
      const response = await fetch('/sandbox/fs/ticket', { credentials: 'same-origin' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(fromServer(say(), payload.error, 'error.preview'))
      return payload.ticket
    }

    /**
     * The URL an HTML preview is loaded from.
     * @param {string} ticket - a minted ticket.
     * @param {string} path - the file's absolute path.
     * @returns {string} the URL.
     */
    const previewUrl = (ticket, path) => `/sandbox/preview/${encodeURIComponent(ticket)}/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`

    /**
     * Ask the gateway to change something in the workspace.
     *
     * @param {string} action - `move`, `remove` or `mkdir`.
     * @param {object} body - the paths the action needs.
     * @returns {Promise<object>} what the gateway answered.
     * @throws {Error} carrying the gateway's own message, for the row to show.
     */
    const command = async (action, body) => {
      const response = await fetch(`/sandbox/fs/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(fromServer(say(), payload.error, 'error.act', { status: String(response.status) }))
      return payload
    }

    /**
     * The newest page in the workspace, and when it was written.
     *
     * One answer covers both questions the canvas has: which page to show, and
     * whether the one on screen is still current.
     *
     * @returns {Promise<{path: string, modified: number}|undefined>} the page, or undefined when there is none.
     */
    const newestPage = async () => {
      const response = await fetch('/sandbox/fs/newest', { credentials: 'same-origin' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(fromServer(say(), payload.error, 'error.read', { status: String(response.status) }))
      return payload.path === undefined ? undefined : payload
    }

    /** The last segment of a path, which is what a tab is called. */
    const basename = (path) => path.slice(path.lastIndexOf('/') + 1) || path

    /**
     * Clamp a width to what the window can spare.
     * @param {number} width - the requested width in px.
     * @returns {number} the width the panel will actually take.
     */
    const clampWidth = (width) => {
      const ceiling = Math.max(MIN_WIDTH, Math.round(window.innerWidth * MAX_FRACTION))
      return Math.min(ceiling, Math.max(MIN_WIDTH, Math.round(width)))
    }

    /**
     * The tab bar: the open tabs, then the control that closes the panel.
     * @param {object} props - tabs, the active id, and the three gestures.
     * @returns {object} the element.
     */
    function TabBar({ tabs, activeId, onSelect, onClose, onNew, onOpen, onCollapse, onMaximise, maximised }) {
      const t = useT()
      const strip = React.useRef(null)
      // The `+` menu: the button it hangs from, and where it landed once it
      // had been measured.
      const plus = React.useRef(null)
      const menu = React.useRef(null)
      const [listing, setListing] = React.useState(false)
      const [place, setPlace] = React.useState(undefined)

      // Keep the tab in play in view. Opening a file when the strip is already
      // full otherwise puts the new tab off the end, so the one thing that
      // just happened is the one thing that cannot be seen.
      //
      // The scroll is computed rather than left to `scrollIntoView`, which
      // decides for itself which ancestor to move and was observed moving
      // none of them: the strip stayed at 46px of a possible 433 with the new
      // tab well off its right edge. This moves the one box that scrolls, by
      // the smallest amount that brings the tab inside it.
      React.useEffect(() => {
        const box = strip.current
        const active = box?.querySelector('[aria-selected="true"]')
        if (box === null || box === undefined || active === null || active === undefined) return
        // Measured as rectangles rather than through `offsetLeft`, which is
        // relative to the nearest POSITIONED ancestor — here the panel, which
        // is fixed, not the strip. That offset by the strip's own padding is
        // enough to leave the tab a few pixels short of visible.
        const box_ = box.getBoundingClientRect()
        const it = active.getBoundingClientRect()
        if (it.left < box_.left) box.scrollLeft += it.left - box_.left
        else if (it.right > box_.right) box.scrollLeft += it.right - box_.right
      }, [activeId, tabs.length])

      // A wheel over the strip scrolls it sideways.
      //
      // A mouse has one wheel and it reports on `deltaY`; a strip that only
      // answers `deltaX` is a strip only a trackpad can move, which leaves the
      // tabs past the edge reachable by dragging alone. Both axes are taken
      // and the larger wins, so a trackpad's sideways gesture still arrives as
      // itself rather than being added to the same number twice.
      //
      // Attached here rather than as `onWheel`, and this is the whole reason
      // for the effect: React registers wheel handlers on its root as PASSIVE,
      // so `preventDefault` inside one does nothing but log a warning — the
      // strip would scroll sideways AND the conversation behind it would scroll
      // away underneath. A native listener with `passive: false` is the only
      // form that can hold the page still.
      //
      // The default is only refused when this strip can actually take the
      // scroll: with every tab already in view, a wheel over the row belongs
      // to whatever is behind it.
      React.useEffect(() => {
        const box = strip.current
        if (box === null || box === undefined) return undefined
        /** @param {WheelEvent} event - the wheel. */
        const onWheel = (event) => {
          const over = box.scrollWidth - box.clientWidth
          if (over <= 0) return
          const by = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
          if (by === 0) return
          const before = box.scrollLeft
          box.scrollLeft += by
          // Only when it moved: at either end the row has nothing left to
          // give, and holding the page still there makes the panel feel stuck.
          if (box.scrollLeft !== before) event.preventDefault()
        }
        box.addEventListener('wheel', onWheel, { passive: false })
        return () => { box.removeEventListener('wheel', onWheel) }
      }, [])

      // The menu closes to anything that is not itself, the way the tree's
      // does: a pointer elsewhere, Escape, or the panel being resized under
      // it. Capture, so the click that closes it does not also land on
      // whatever was underneath.
      React.useEffect(() => {
        if (!listing) return undefined
        const away = (event) => {
          if (menu.current?.contains(event.target) === true) return
          if (plus.current?.contains(event.target) === true) return
          setListing(false)
        }
        const onKey = (event) => { if (event.key === 'Escape') setListing(false) }
        const shut = () => { setListing(false) }
        document.addEventListener('pointerdown', away, true)
        document.addEventListener('keydown', onKey)
        window.addEventListener('resize', shut)
        return () => {
          document.removeEventListener('pointerdown', away, true)
          document.removeEventListener('keydown', onKey)
          window.removeEventListener('resize', shut)
        }
      }, [listing])

      // Measured after it is drawn, because where it fits depends on how wide
      // it turned out to be. Hung from the button's RIGHT edge rather than its
      // left: the panel is the window's right-hand column, and a menu that
      // grows rightward from a control near that edge grows off the screen.
      React.useLayoutEffect(() => {
        if (!listing || menu.current === null || plus.current === null) { setPlace(undefined); return }
        const button = plus.current.getBoundingClientRect()
        const box = menu.current.getBoundingClientRect()
        setPlace({
          left: Math.max(8, Math.min(button.right - box.width, window.innerWidth - box.width - 8)),
          top: button.bottom + 6,
        })
      }, [listing, tabs.length])

      // The bar is always drawn, because the controls that close and widen the
      // panel live in it and have to be reachable with nothing open. Its rule
      // is not: with no tabs there is nothing above the line to divide from
      // what is below it.
      return h('div', { className: `${NS}-tabbar`, 'data-empty': tabs.length === 0 ? '' : undefined },
        h('div', { className: `${NS}-tabs`, role: 'tablist', ref: strip }, tabs.map((tab) => h('div', {
          key: tab.id,
          role: 'tab',
          tabIndex: 0,
          'aria-selected': tab.id === activeId,
          className: `${NS}-tab`,
          onClick: () => onSelect(tab.id),
          // The middle button closes the tab, which is what a middle button
          // does to a tab everywhere else it exists — and the one gesture that
          // closes several in a row without the pointer having to find a 16px
          // target each time.
          //
          // `onAuxClick` rather than a button test inside `onClick`: React
          // routes the non-primary buttons there, and a middle press never
          // reaches the click handler at all. The mousedown is refused
          // separately because middle-press is the browser's autoscroll
          // gesture, which otherwise starts on the tab strip and leaves the
          // page in scroll mode after the tab has gone.
          onMouseDown: (event) => { if (event.button === 1) event.preventDefault() },
          onAuxClick: (event) => {
            if (event.button !== 1) return
            event.preventDefault()
            onClose(tab.id)
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelect(tab.id)
            }
          },
        },
        h('span', { className: `${NS}-tab-icon` }, icon(tab.icon ?? 'file', 14)),
        h('span', { className: `${NS}-tab-label` }, tab.label ?? t(`tool.${tab.id}`)),
        // Rendered on every tab, shown by CSS under the pointer. Rendering it
        // only for the active tab was the first attempt and it does not answer
        // the requirement: hovering any other tab found no element to reveal.
        // Showing it costs no reflow: it is positioned rather than laid out,
        // so no tab changes width when the pointer arrives or leaves.
        h('span', {
          className: `${NS}-tab-close`,
          role: 'button',
          'aria-label': t('tab.close', { name: tab.label ?? t(`tool.${tab.id}`) }),
          onClick: (event) => {
            event.stopPropagation()
            onClose(tab.id)
          },
        }, icon('close', 12))))),
        // The way to a tool, kept against the tabs because that is what it
        // adds to: after the last one, and at the head of the row when there
        // are none. Drawn whether or not anything is open, which is what makes
        // the row permanent — a bar whose controls come and go is a bar you
        // have to look for before you can use it.
        h('button', {
          ref: plus,
          type: 'button',
          className: `${NS}-icon-button`,
          title: t('panel.open'),
          'aria-label': t('panel.open'),
          'aria-pressed': activeId === undefined,
          'aria-haspopup': tabs.length === 0 ? undefined : 'menu',
          'aria-expanded': tabs.length === 0 ? undefined : listing,
          // With nothing open the panel is already showing the chooser, so the
          // `+` only has to make sure it is what is on screen. With something
          // open, sending the panel to the chooser would take the tab away to
          // ask a question — the tenant would lose sight of what they were
          // reading in order to add something beside it. So the choice comes
          // to them instead, as a menu hanging off the control they pressed,
          // and whatever is open stays open behind it.
          onClick: () => { if (tabs.length === 0) onNew(); else setListing((open) => !open) },
        }, icon('new')),
        // Drawn beside the button rather than inside it: `overflow` on the tab
        // strip would clip it, and the row's own stacking context would put it
        // under the panel's chrome.
        !listing || tabs.length === 0 ? null : h('div', {
          ref: menu,
          role: 'menu',
          className: `${NS}-menu`,
          style: {
            left: `${String(place?.left ?? 0)}px`,
            top: `${String(place?.top ?? 0)}px`,
            // Placed on the second pass; drawn where it will land rather than
            // at the corner and then moved, which reads as a jump.
            visibility: place === undefined ? 'hidden' : undefined,
          },
        }, TOOLS.map((tool) => h('button', {
          key: tool.id,
          type: 'button',
          role: 'menuitem',
          className: `${NS}-menu-item ${NS}-menu-tool`,
          // Opening what is already open is focusing it, which is what the
          // chooser has always done — so there is nothing to disable here.
          onClick: () => { setListing(false); onOpen(tool) },
        }, h('span', null, icon(tool.icon, 15)), h('span', null, t(`tool.${tool.id}`))))),
        // What is about the panel rather than about one tab sits at its far
        // edge, so the row reads as tabs on one side and panel controls on the
        // other.
        h('span', { className: `${NS}-spacer` }),
        // Widen to everything but the tenant's own sidebar.
        h('button', {
          type: 'button',
          className: `${NS}-icon-button`,
          title: t(maximised ? 'panel.restore' : 'panel.expand'),
          'aria-label': t(maximised ? 'panel.restore' : 'panel.expand'),
          'aria-pressed': maximised,
          onClick: onMaximise,
        }, icon(maximised ? 'shrink' : 'expand')),
        // The same control as the one in the session header, by the same
        // class and the same glyph — not a second control that also closes the
        // panel. It is here rather than there because that is where it is
        // needed once the panel is open.
        h('button', {
          type: 'button',
          className: `${NS}-toggle`,
          title: t('panel.collapse'),
          'aria-label': t('panel.collapse'),
          onClick: onCollapse,
        }, icon('panel')),
      )
    }

    /**
     * What an open panel with no tabs shows.
     * @param {object} props - the opener for a chosen tool.
     * @returns {object} the element.
     */
    function EmptyState({ onOpen, open }) {
      const t = useT()
      return h('div', { className: `${NS}-empty` },
        h('div', { className: `${NS}-choices` },
          TOOLS.map((tool) => h('button', {
            key: tool.id,
            type: 'button',
            className: `${NS}-choice`,
            // The sentence the card used to carry as a third line. Kept, and
            // kept where a sentence belongs on a control this small — it still
            // says what the tool is for, and it still says when the tool is
            // already open, which reads as a state rather than as a disabled
            // control: the click works either way, it just focuses what is
            // there.
            title: open.some((tab) => tab.id === tool.id) ? t('empty.opened') : t(`tool.${tool.id}.note`),
            onClick: () => onOpen(tool),
          },
          h('span', { className: `${NS}-choice-icon` }, icon(tool.icon, 18)),
          h('span', null, t(`tool.${tool.id}`))))),
      )
    }

    /**
     * The body of a tab that has no data plane yet.
     * @param {object} props - the tab being stood in for.
     * @returns {object} the element.
     */
    function Placeholder({ tab }) {
      const t = useT()
      return h('div', { className: `${NS}-placeholder` },
        h('div', null, t('stub.title', { name: tab.label ?? t(`tool.${tab.id}`) })),
        h('div', null, t('stub.note')),
      )
    }


    /**
     * The row's own control: one button that opens the menu.
     *
     * One button rather than the two it replaced. Two icons on a row that is
     * mostly a name reads as a row of controls with a label attached, and the
     * menu is where a second action would have gone anyway.
     *
     * @param {object} props - the entry the menu is about.
     * @returns {object} the element.
     */
    function RowMenu({ entry }) {
      const t = useT()
      return h('span', { className: `${NS}-row-menu` },
        h('button', {
          type: 'button',
          className: `${NS}-row-action`,
          title: t('more'),
          'aria-label': t('more.of', { name: entry.name }),
          'aria-haspopup': 'menu',
          onClick: (event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            treeStore.openMenu({ entry, x: rect.left, y: rect.bottom + 4 })
          },
        }, icon('more', 14)),
      )
    }


    /**
     * One directory's children, loaded when it is first opened.
     *
     * A level at a time rather than a whole tree: a workspace can hold a
     * `node_modules`, and reading it to draw one row would cost the tenant's
     * sandbox real work for something nobody asked to see.
     *
     * Recursion carries `depth` only to indent — the shape of the tree is the
     * component nesting itself, so there is no flattened model to keep in step
     * with what is on screen.
     *
     * @param {object} props - the directory, how deep it sits, and what to do with a file.
     * @returns {object|null} the rows.
     */
    /**
     * Scroll a row into view once the tree has been taken to it.
     *
     * A callback ref rather than an effect, because the row does not exist
     * until the branch holding it has expanded — which happens in the same
     * render that asks for it. `block: 'nearest'` so a row already on screen
     * does not jump.
     *
     * @param {Element|null} node - the row, or null as it unmounts.
     */
    const taken = (node) => { node?.scrollIntoView({ block: 'nearest' }) }

    function Branch({ path, depth, onOpen, activePath, at }) {
      const t = useT()
      const tree = useTree()
      const node = tree.dirs[path]

      // Read once when this branch appears. It is not re-read on a timer or
      // on every draw any more: the workspace says when it changed.
      React.useEffect(() => { treeStore.load(path) }, [path])

      // And re-read exactly the directory a change happened in — not the whole
      // tree, and not this branch unless the change was in it.
      React.useEffect(() => workspaceWatch.subscribe((change) => {
        // `stale` means the change is unknown rather than elsewhere, so this
        // branch re-reads instead of deciding it was not about it.
        if (change.stale === true) { treeStore.load(path); return }
        const parent = change.path.slice(0, change.path.lastIndexOf('/')) || ROOT
        if (parent === path) treeStore.load(path)
      }), [path])

      const indent = { paddingLeft: `${String(depth * 14 + 12)}px` }
      if (node?.entries === undefined) {
        if (node?.status === 'failed') return h('div', { className: `${NS}-tree-note`, style: indent }, node.message)
        return h('div', { className: `${NS}-tree-note`, style: indent }, t('loading'))
      }

      // The filter narrows what is already loaded. Directories are kept
      // whatever they are called, because what is being looked for may be
      // inside one — and this cannot know without reading it, which is exactly
      // the work the tree loads lazily to avoid.
      const needle = tree.filter.trim().toLowerCase()
      const matching = needle === ''
        ? node.entries
        : node.entries.filter((entry) => entry.directory || entry.name.toLowerCase().includes(needle))

      if (matching.length === 0) {
        return h('div', { className: `${NS}-tree-note`, style: indent }, t(needle === '' ? 'tree.empty' : 'tree.nomatch'))
      }

      // Directories first, then by name, folded case — the order a person
      // expects rather than the order the filesystem happened to answer in.
      const entries = [...matching].sort((a, b) => (
        a.directory === b.directory
          ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
          : (a.directory ? -1 : 1)
      ))

      return h(React.Fragment, null, entries.map((entry) => {
        // Open because someone opened it, or because a filter is narrowing the
        // tree — the point of typing is to see what matches, not to then go
        // looking for it. Revealing writes to the shared state instead of
        // overriding here, so a revealed directory can still be closed.
        const expanded = tree.open[entry.path] === true || (needle !== '' && entry.directory)
        return h(React.Fragment, { key: entry.path },
          // A row rather than a button, because it CONTAINS buttons and a
          // button inside a button is not a thing HTML has. The role and the
          // key handling are what a button would have given for free.
          h('div', {
            className: `${NS}-row`,
            role: 'treeitem',
            tabIndex: 0,
            // Brought into view when the tree is taken here — see `TakenTo`.
            ref: entry.path === at?.path ? taken : undefined,
            'aria-expanded': entry.directory ? expanded : undefined,
            style: { paddingLeft: `${String(depth * 14 + 8)}px` },
            // The open file, or the directory a breadcrumb just named. Both are
            // "where you are", and the tree is the one place that can say so.
            'aria-current': entry.path === activePath || entry.path === at?.path ? 'true' : undefined,
            title: entry.path,
            onClick: () => {
              if (entry.directory) treeStore.toggle(entry.path)
              else onOpen(entry)
            },
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              if (entry.directory) treeStore.toggle(entry.path)
              else onOpen(entry)
            },
            // The browser's own menu is refused here, because everything on it
            // is about a web page — reload, view source, save image — and none
            // of it is about the file this row names.
            onContextMenu: (event) => {
              event.preventDefault()
              treeStore.openMenu({ entry, x: event.clientX, y: event.clientY })
            },
          },
          entry.directory
            ? h('span', {
              className: `${NS}-row-twisty`,
              // Rotated rather than swapped for a second glyph: one icon, one
              // state, and the turn reads as the thing opening.
              style: { transform: expanded ? 'rotate(90deg)' : 'none' },
            }, icon('chevron', 12))
            // Nothing at all for a file, rather than an empty box the width of
            // the control it does not have.
            //
            // The column was there so that every name in a listing began on
            // one vertical line, which is the usual argument for it — and it
            // is an argument that holds where directories are most of what is
            // listed. A workspace is the other case: a tenant's tree is files
            // with the odd folder in it, so the reserved column mostly held
            // nothing, and it held nothing at the very left edge, where it
            // read as the whole tree having been nudged off its own margin.
            //
            // What it costs is that a folder's name sits 18px right of a
            // file's at the same depth. That is the folder wearing a control,
            // which is a true thing about it — and the indent that says which
            // folder a file is IN is the depth padding, which is untouched.
            : null,
          // A file wears its kind; a directory wears its chevron and nothing
          // else.
          //
          // The folder glyph was beside that chevron and said the same thing
          // twice — a mark that means "this contains things" next to a control
          // that only exists on things that contain things. Two marks for one
          // fact is also two marks the eye has to skip before the name, on the
          // rows where the name matters most.
          //
          // For a file the call is the same one the tab makes, so a file wears
          // one icon in this deployment rather than one here and another on
          // the tab it opens. Every file was `file` before, which is the icon
          // for "nothing is known about this" shown for everything that was
          // known.
          entry.directory ? null : h('span', { className: `${NS}-row-icon` },
            icon(iconFor(entry.path), 14)),
          h('span', { className: `${NS}-row-name` }, entry.name),
          h(RowMenu, { entry })),
          expanded ? h(Branch, { path: entry.path, depth: depth + 1, onOpen, activePath, at }) : null)
      }))
    }

    /**
     * The workspace, as a tree, with a box to narrow it.
     *
     * The box filters rather than searches, and is labelled so. Searching
     * would mean walking the tenant's whole workspace in their sandbox on
     * every keystroke; this narrows what has already been read, which is what
     * someone scanning a directory they are looking at actually wants.
     *
     * Everything it shows — what is open, what was read, what is typed — lives
     * in `treeStore`, not here, because the same tree appears in every file
     * tab and they are one tree.
     *
     * @param {object} props - what to do when a file is chosen, and which one is showing.
     * @returns {object} the element.
     */
    function FileTree({ onOpen, activePath }) {
      const t = useT()
      const tree = useTree()
      // Where the tree was last taken, which is a breadcrumb's whole effect.
      const at = tree.at
      return h(React.Fragment, null,
        h('div', { className: `${NS}-filter` }, h('input', {
          type: 'search',
          value: tree.filter,
          placeholder: t('filter.placeholder'),
          'aria-label': t('filter.label'),
          onChange: (event) => treeStore.setFilter(event.target.value),
        })),
        // The empty space below the rows is still the workspace, so pointing
        // at it offers what can be made in the workspace. Only when the click
        // landed on nothing: a row handles its own, and this would otherwise
        // replace the menu it just opened.
        h('div', {
          className: `${NS}-scroll`,
          onContextMenu: (event) => {
            if (event.defaultPrevented) return
            event.preventDefault()
            treeStore.openMenu({ entry: undefined, x: event.clientX, y: event.clientY })
          },
        },
          h('div', { className: `${NS}-tree` },
            h(Branch, { path: ROOT, depth: 0, onOpen, activePath, at }))),
      )
    }

    /**
     * Which viewer a file gets.
     *
     * An internal table, deliberately not a registry: a service other plugins
     * could register into is a public API to keep true forever, and adding a
     * type here is adding a line. The unknown case falls to text rather than
     * to a download, because an unrecognised file in a workspace is almost
     * always text and being shown it beats being asked to save it.
     *
     * @param {string} path - the file's path.
     * @returns {'image'|'html'|'text'} the viewer to use.
     */
    /**
     * Extensions whose bytes are not text and have no viewer here.
     *
     * Everything used to fall through to the text viewer, which fetched the
     * bytes, decoded them as UTF-8 and painted whatever came out — so opening a
     * zip filled the pane with mojibake. That is worse than a refusal: it looks
     * like a broken file rather than a viewer that was never written, and it
     * costs the whole download to say nothing.
     *
     * Named rather than sniffed. Reading the first bytes to guess would be a
     * round trip to answer a question the extension already answers for every
     * file anyone actually opens, and a wrong guess about a text file is a
     * pane that refuses something it could have shown.
     */
    const OPAQUE = new Set([
      'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'rar', '7z', 'jar', 'war',
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods',
      'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
      'mp4', 'webm', 'mov', 'mkv', 'avi', 'wmv',
      'so', 'dylib', 'dll', 'exe', 'bin', 'o', 'a', 'class', 'wasm',
      'ttf', 'otf', 'woff', 'woff2', 'eot',
      'db', 'sqlite', 'sqlite3', 'parquet',
    ])

    function viewerFor(path) {
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico'].includes(ext)) return 'image'
      if (['html', 'htm'].includes(ext)) return 'html'
      if (['md', 'markdown'].includes(ext)) return 'markdown'
      if (OPAQUE.has(ext)) return 'opaque'
      return 'text'
    }

    /**
     * The grammar name to highlight a file under.
     *
     * Mapped from the extension rather than passed through, because a fence
     * info string and a file extension only sometimes agree — `.py` is
     * `python`, `.yml` is `yaml`. An unmapped extension is handed over as-is:
     * shiki either knows it or renders plain, and both are better than
     * deciding here that it cannot be highlighted.
     *
     * @param {string} path - the file's path.
     * @returns {string} a grammar hint.
     */
    /**
     * What each extension is highlighted as.
     *
     * Out here rather than inside `grammarFor`, because two questions read it:
     * which grammar to colour a file with, and whether the thing is code at
     * all. The second cannot be answered from the first's return — a lookup
     * that misses answers with the extension itself, and several entries
     * (`go`, `c`, `json`) answer with it too.
     */
    const GRAMMARS = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
      ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
      py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
      c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
      sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish',
      yml: 'yaml', yaml: 'yaml', json: 'json', toml: 'toml', ini: 'ini',
      css: 'css', scss: 'scss', less: 'less', html: 'html', xml: 'xml',
      sql: 'sql', php: 'php', swift: 'swift', kt: 'kotlin', lua: 'lua',
      dockerfile: 'dockerfile', makefile: 'makefile',
    }

    function grammarFor(path) {
      const name = basename(path).toLowerCase()
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
      return GRAMMARS[ext] ?? ext
    }

    /**
     * One file's own bytes, in whichever of the four shapes it comes in.
     *
     * Text and markdown are fetched here; an image and an HTML page are handed
     * a URL and left to the browser, which is both less code and the only way
     * an HTML page's own relative assets resolve.
     *
     * @param {object} props - the file's path and, for markdown, which face to show.
     * @returns {object} the element.
     */
    function FileBody({ path, source, onText }) {
      const t = useT()
      const kind = viewerFor(path)
      const wants = kind === 'text' || kind === 'markdown'
      const [text, setText] = React.useState({ status: 'loading' })
      const [ticket, setTicket] = React.useState({ status: 'loading' })

      /**
       * Bumped whenever what is on screen might no longer be the file.
       *
       * Everything below keys off the path, and a path does not change when
       * its contents do — so an agent rewriting the open file, or a person
       * pressing refresh, changed nothing here. The frame was the visible
       * case, because a browser will not re-fetch a src it already has, but
       * text and images were just as stale and quieter about it.
       *
       * `stale` means the sandbox knows something moved without knowing what,
       * which is also what the refresh control sends.
       */
      const [revision, setRevision] = React.useState(0)
      React.useEffect(() => workspaceWatch.subscribe((change) => {
        if (change.stale === true || change.path === path) setRevision((n) => n + 1)
      }), [path])

      /**
       * The two viewers that would not otherwise notice.
       *
       * Text and markdown fetch their own bytes and hear a 404 for
       * themselves. An image and an HTML page hand a URL to the browser and
       * never learn what came back — a deleted image becomes a broken-image
       * glyph and a deleted page becomes the gateway's own 404 rendered
       * inside the frame, both of them under a tab still bearing the file's
       * name.
       */
      React.useEffect(() => {
        if (kind !== 'image' && kind !== 'html') return undefined
        let live = true
        stillThere(path).then((there) => { if (live && !there) store.forget(path) })
        return () => { live = false }
      }, [path, kind, revision])

      React.useEffect(() => {
        if (kind !== 'html') return undefined
        let live = true
        setTicket({ status: 'loading' })
        // Reminted rather than reused: a ticket lasts minutes and a tab can be
        // open for hours, so refreshing an old one with a stale ticket would
        // load a page whose every asset 401s.
        mintTicket().then(
          (value) => { if (live) setTicket({ status: 'ready', value }) },
          (error) => { if (live) setTicket({ status: 'failed', message: error.message }) },
        )
        return () => { live = false }
      }, [path, kind, revision])

      React.useEffect(() => {
        if (!wants) return undefined
        let live = true
        setText({ status: 'loading' })
        fetch(rawUrl(path), { credentials: 'same-origin' }).then(
          async (response) => {
            const body = await response.text()
            if (!live) return
            if (!response.ok) {
              // Gone, rather than unreadable. The tab is about a file, and
              // there is no longer one — so it closes instead of standing
              // there explaining that what it is named after is missing.
              if (response.status === 404) { store.forget(path); return }
              let message = t('error.read', { status: String(response.status) })
              try { message = JSON.parse(body).error ?? message } catch { /* not JSON; keep the status */ }
              setText({ status: 'failed', message })
              return
            }
            setText({ status: 'ready', body })
            onText?.(body)
          },
          (error) => { if (live) setText({ status: 'failed', message: error.message }) },
        )
        return () => { live = false }
      }, [path, wants, revision])

      // Said, rather than shown as whatever the bytes decode to. Nothing is
      // fetched for one of these: the answer does not depend on the contents,
      // and downloading a hundred megabytes of video to report that it cannot
      // be played is the cost of the old behaviour without the mojibake.
      if (kind === 'opaque') {
        return h('div', { className: `${NS}-placeholder` }, t('preview.opaque'))
      }
      if (kind === 'image') {
        return h('div', { className: `${NS}-media` },
          h('img', { key: `${path}:${String(revision)}`, className: `${NS}-image`, src: rawUrl(path), alt: basename(path) }))
      }
      if (kind === 'html') {
        if (ticket.status === 'loading') return h('div', { className: `${NS}-placeholder` }, t('preview.preparing'))
        if (ticket.status === 'failed') return h('div', { className: `${NS}-placeholder` }, ticket.message)
        // `sandbox` without `allow-same-origin`, so the previewed page gets an
        // opaque origin and cannot read the session it was fetched with. The
        // gateway sends the same restriction as a header, which holds even if
        // the page is opened outside this frame. That opacity is also why the
        // URL carries a ticket: an opaque origin sends no cookies, so without
        // one the page would load and every asset in it would 401.
        // Keyed by revision as well as path, which is what actually reloads
        // it: React reuses an iframe whose src is unchanged, and the src has
        // to stay unchanged so the page's own relative assets keep resolving.
        return h('iframe', {
          key: `${path}:${String(revision)}`,
          className: `${NS}-frame`,
          src: previewUrl(ticket.value, path),
          sandbox: 'allow-scripts allow-popups allow-downloads allow-modals',
          title: basename(path),
        })
      }
      if (text.status === 'loading') return h('div', { className: `${NS}-placeholder` }, t('loading'))
      if (text.status === 'failed') return h('div', { className: `${NS}-placeholder` }, text.message)

      // Markdown, rendered, unless its source was asked for.
      if (kind === 'markdown' && !source && primitives.MarkdownText !== undefined) {
        return h('div', { className: `${NS}-markdown` }, h(primitives.MarkdownText, {
          text: text.body,
          // The component is cordis-free and takes its copy through props;
          // omitting these leaves a code block's copy button unlabelled.
          codeLabels: { copyLabel: t('copy'), copiedLabel: t('copied') },
        }))
      }
      if (primitives.CodeBlock !== undefined) {
        return h('div', { className: `${NS}-code` }, h(primitives.CodeBlock, {
          code: text.body,
          lang: kind === 'markdown' ? 'markdown' : grammarFor(path),
          copyLabel: t('copy'),
          copiedLabel: t('copied'),
        }))
      }
      // No primitives in this shell: the file is still readable, just plain.
      return h('pre', { className: `${NS}-text` }, text.body)
    }


    /**
     * The icon a file tab wears.
     *
     * By kind rather than by extension: a tab is telling someone what sort of
     * thing they are about to look at, and four answers cover a workspace.
     *
     * @param {string} path - the file's path.
     * @returns {string} the glyph's name in `GLYPHS`.
     */
    /**
     * Kinds a viewer does not distinguish but a reader scanning a tree does.
     *
     * Everything here opens as text or does not open at all, so `viewerFor`
     * has no reason to tell them apart — but a column of thirty identical
     * pages is a column nobody can scan, and the extension is already on the
     * row saying which is which. The icon is the same fact, read faster.
     *
     * Keyed by extension rather than by the grammar name, because the grammar
     * table answers "how is this highlighted" and several of these have no
     * grammar at all.
     */
    const KIND_BY_EXTENSION = {
      json: 'data', yml: 'data', yaml: 'data', toml: 'data', ini: 'data', env: 'data',
      zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive',
      xz: 'archive', rar: 'archive', '7z': 'archive',
      // No pdf: the set this half comes from has no honest mark for one, and a
      // page with a badge that says something else is worse than the plain
      // page. The panel cannot open one either, so nothing is lost by it
      // looking like every other file it cannot open.
      csv: 'table', tsv: 'table', xls: 'table', xlsx: 'table',
      mp3: 'media', wav: 'media', ogg: 'media', flac: 'media',
      mp4: 'media', webm: 'media', mov: 'media', mkv: 'media',
    }

    function iconFor(path) {
      const kind = viewerFor(path)
      if (kind === 'image') return 'image'
      if (kind === 'html') return 'browser'
      if (kind === 'markdown') return 'markdown'
      const name = basename(path).toLowerCase()
      const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
      const byExtension = KIND_BY_EXTENSION[extension]
      if (byExtension !== undefined) return byExtension
      // Code when the grammar table knows the extension, and a plain page
      // otherwise. The test used to be whether `grammarFor` answered with the
      // name it was given, which made every unfamiliar extension code — a
      // `.log` and a `.bak` wore the same icon as a `.rs` — and every
      // extensionless file plain, which made `Makefile` and `Dockerfile`
      // documents. Both are the wrong way round, and neither showed while
      // only the tab read this.
      return GRAMMARS[extension === '' ? name : extension] === undefined ? 'file' : 'code'
    }


    /**
     * The path of the file on show, as a row of places that can be gone to.
     *
     * Each level is a button: the tree opens to that directory rather than the
     * pointer having to walk back down it. The last segment is the file itself
     * and is not a link — it is where you already are.
     *
     * @param {object} props - the file's path (or none) and what to reveal with.
     * @returns {object} the element.
     */
    function Crumbs({ path, onReveal }) {
      if (path === undefined) {
        // The root, stated. With no file open the row still holds a path, so
        // the structure does not appear and disappear as files are chosen.
        return h('div', { className: `${NS}-crumb-path` },
          h('button', { type: 'button', className: `${NS}-crumb`, onClick: () => onReveal(ROOT) }, '/'))
      }
      const segments = path.split('/').filter(Boolean)
      // A crumb is a way into the tree, so it is only a control while the tree
      // is where the path leads. For a file opened from outside the workspace
      // the row still says where the file is — that is the question it answers
      // — but nothing in it offers to go somewhere it cannot.
      const navigable = insideWorkspace(path)
      return h('div', { className: `${NS}-crumb-path`, title: path }, segments.map((segment, index) => {
        const here = `/${segments.slice(0, index + 1).join('/')}`
        const last = index === segments.length - 1
        return h(React.Fragment, { key: here },
          h('span', { className: `${NS}-crumb-sep` }, '/'),
          last || !navigable
            ? h('span', { className: `${NS}-crumb-name` }, segment)
            : h('button', { type: 'button', className: `${NS}-crumb`, onClick: () => onReveal(here) }, segment))
      }))
    }

    /**
     * A pane's side column, and the control that folds it away.
     *
     * Folded it becomes a strip with one button, rather than disappearing:
     * something that vanishes entirely has to be found again, and the strip is
     * where it was. The content it makes room for is the point — a file or a
     * shell is what the panel is for, and the list beside it is how you got
     * there.
     *
     * @param {object} props - which pane this belongs to, its heading, and its rows.
     * @returns {object} the element.
     */
    function Aside({ kind, title, children }) {
      const { folded } = useStore()
      // Folded means gone, not narrowed. A strip was the first version and it
      // kept 36px of nothing; the control that brings the column back lives in
      // the pane's own title row, so there is nothing left for a strip to do.
      if (folded[kind] === true) return null

      return h('div', { className: `${NS}-split-aside` },
        h('div', { className: `${NS}-aside-head` }, h('span', { className: `${NS}-aside-title` }, title)),
        children)
    }

    /**
     * The control that folds a pane's side column, for the pane's title row.
     * @param {object} props - which column it folds.
     * @returns {object} the element.
     */
    function FoldButton({ kind, title }) {
      const t = useT()
      const { folded } = useStore()
      const closed = folded[kind] === true
      return h('button', {
        type: 'button',
        className: `${NS}-icon-button`,
        'aria-pressed': !closed,
        title: t(closed ? 'expand' : 'collapse', { title }),
        'aria-label': t(closed ? 'expand' : 'collapse', { title }),
        onClick: () => store.fold(kind),
      }, icon('aside'))
    }

    /* A list, not a panel. The first version of this control used the same
       panel outline the panel's own toggle uses, so the two levels looked like
       one control drawn twice — and they do different things: one folds the
       side list, the other closes the whole panel. */

    /**
     * Every shell that is open, and the one on show.
     *
     * All of them stay mounted. A terminal is a live process at the far end of
     * a socket, and unmounting the one you are not looking at would end it —
     * so the others are hidden rather than taken down, and switching back
     * finds the same session with its scrollback where it was left.
     *
     * @returns {object} the element.
     */
    function TerminalPane() {
      const t = useT()
      const { terminals, activeTerminal } = useStore()

      // One shell to begin with: opening the terminal tab is a request for a
      // terminal, not for a list of none.
      React.useEffect(() => {
        if (terminals.length === 0) store.addTerminal()
      }, [terminals.length])

      // Built as named pieces rather than one nested call: the shells, the
      // list beside them, and the way to start another.
      const screens = terminals.map((entry) => h('div', {
        key: entry.id,
        className: `${NS}-console-slot`,
        // Hidden, not unmounted. See above.
        style: { display: entry.id === activeTerminal ? 'block' : 'none' },
      }, h(Console, null)))

      const rows = terminals.map((entry) => h('div', {
        key: entry.id,
        className: `${NS}-row`,
        role: 'option',
        tabIndex: 0,
        'aria-current': entry.id === activeTerminal ? 'true' : undefined,
        onClick: () => store.selectTerminal(entry.id),
        onKeyDown: (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          store.selectTerminal(entry.id)
        },
      },
      // No twisty, and none reserved: nothing in this list opens.
      h('span', { className: `${NS}-row-icon` }, icon('terminal', 14)),
      h('span', { className: `${NS}-row-name` }, entry.name),
      h('span', { className: `${NS}-row-menu` },
        h('button', {
          type: 'button',
          className: `${NS}-row-action`,
          title: t('terminal.end'),
          'aria-label': t('terminal.end.of', { name: entry.name }),
          onClick: (event) => { event.stopPropagation(); store.closeTerminal(entry.id) },
        }, icon('close', 12)))))

      const showing = terminals.find((entry) => entry.id === activeTerminal)

      return h('div', { className: `${NS}-file` },
        // The same row the file pane has, holding the same kinds of thing:
        // where you are on the left, and what can be done about it on the
        // right. A terminal's "where" is which session is on screen.
        h('div', { className: `${NS}-crumbs` },
          h('div', { className: `${NS}-crumb-path` },
            h('span', { className: `${NS}-crumb-name` }, showing?.name ?? t('terminal'))),
          h('button', {
            type: 'button',
            className: `${NS}-icon-button`,
            title: t('terminal.new'),
            'aria-label': t('terminal.new'),
            onClick: () => { store.addTerminal() },
          }, icon('new', 15)),
          h(FoldButton, { kind: 'terminal', title: t('terminal.list') })),
        h('div', { className: `${NS}-split` },
          h('div', { className: `${NS}-split-main` }, screens),
          h(Aside, { kind: 'terminal', title: t('terminal.count', { n: String(terminals.length) }) },
            h('div', { className: `${NS}-scroll` }, rows))))
    }

    /**
     * The workspace pane: where you are, what you can do with it, and the file
     * beside the tree it was chosen from.
     *
     * One shape whether or not a file is open. The tree tab and a file tab are
     * the same component with and without a `path`, so opening the first file
     * fills the empty half rather than rearranging the pane — and the tree,
     * having never moved, is still where it was for the next choice.
     *
     * @param {object} props - the file if there is one, and what to do when another is chosen.
     * @returns {object} the element.
     */
    function WorkspacePane({ path, onOpen }) {
      const t = useT()
      const [source, setSource] = React.useState(false)
      const [copied, setCopied] = React.useState(undefined)
      // The file's own text, when it has one, so the row above it can offer to
      // copy the thing rather than only its address.
      const [text, setText] = React.useState(undefined)
      const markdown = path !== undefined && viewerFor(path) === 'markdown' && primitives.MarkdownText !== undefined

      React.useEffect(() => { setText(undefined) }, [path])

      /**
       * Put something on the clipboard and say so briefly.
       *
       * `writeText` is the only clipboard route a page has without a
       * permission prompt, and it can still be refused; saying nothing on
       * failure beats an error nobody can act on.
       */
      const copy = (what, value) => {
        navigator.clipboard?.writeText(value).then(
          () => { setCopied(what); window.setTimeout(() => setCopied(undefined), 1500) },
          () => {},
        )
      }

      // Switching to a tab opens the tree to that tab's file, so the tree
      // always shows where you are without being asked.
      // Only what the tree can hold. The tree is a workspace browser, so
      // revealing a path from outside it would walk it into directories it
      // does not list and cannot show — an error row for a file that opened
      // perfectly well.
      React.useEffect(() => {
        if (insideWorkspace(path)) treeStore.reveal(path)
      }, [path])

      return h('div', { className: `${NS}-file` },
        h('div', { className: `${NS}-crumbs` },
          h(Crumbs, { path, onReveal: (target) => treeStore.reveal(target, true) }),
          markdown ? h('div', { className: `${NS}-segments` },
            h('button', {
              type: 'button', className: `${NS}-segment`, 'aria-pressed': !source,
              onClick: () => setSource(false),
            }, t('preview')),
            h('button', {
              type: 'button', className: `${NS}-segment`, 'aria-pressed': source,
              onClick: () => setSource(true),
            }, t('source'))) : null,
          // Both actions live here, on the row that names the file — the view
          // below is the file, not a card with its own controls.
          text === undefined ? null : h('button', {
            type: 'button',
            className: `${NS}-icon-button`,
            title: t(copied === 'text' ? 'copied.text' : 'copy.text'),
            'aria-label': t('copy.text'),
            onClick: () => copy('text', text),
          }, icon('copy-text', 15)),
          h('button', {
            type: 'button',
            className: `${NS}-icon-button`,
            disabled: path === undefined,
            title: t(copied === 'path' ? 'copied.path' : 'copy.path'),
            'aria-label': t('copy.path'),
            onClick: () => copy('path', path),
          }, icon('copy', 15)),
          // Look again, by hand.
          //
          // It exists because the panel cannot always be told: envd will not
          // watch a network filesystem, which is what a tenant's workspace is
          // wherever it is a volume. There is a fallback on a timer, and this
          // is the same signal without the wait — for the moment after you
          // make a file and want to see it now.
          h('button', {
            type: 'button',
            className: `${NS}-icon-button`,
            title: t('refresh'),
            'aria-label': t('refresh'),
            onClick: (event) => { turn(event.currentTarget); workspaceWatch.refresh() },
            onAnimationEnd: (event) => { event.currentTarget.removeAttribute('data-turning') },
          }, icon('refresh', 15)),
          h(FoldButton, { kind: 'files', title: t('files.tree') })),
        h('div', { className: `${NS}-split` },
          h('div', { className: `${NS}-split-main` },
            path === undefined
              ? h('div', { className: `${NS}-placeholder` }, t('files.pick'))
              : h(FileBody, { key: `${path}:${String(source)}`, path, source, onText: setText })),
          h(Aside, { kind: 'files', title: t('files.aside') },
            h(FileTree, { onOpen, activePath: path }))),
      )
    }

    /**
     * The canvas: the page the agent is making, as it is being made.
     *
     * Not a browser. A browser would mean reverse-proxying whatever server the
     * agent started — a wildcard certificate, absolute-path rewriting,
     * WebSocket forwarding, an egress boundary — all of it in service of a dev
     * server. What a canvas shows is a file, which this panel can already
     * serve, so the whole of that machinery is not built rather than built
     * carefully.
     *
     * It FOLLOWS: the workspace says when something changed, and if what
     * changed was a page the canvas looks again. That is a deliberate
     * exception to the rule that nothing here moves without a click, and it is
     * bounded to this tab — opening the canvas is the tenant saying "show me
     * what you are making". It still never opens the panel by itself, and
     * never touches another tab.
     *
     * It used to ask every two seconds instead. The events cost nothing when
     * nothing happens, and arrive at once when something does.
     *
     * @returns {object} the element.
     */
    function Canvas() {
      const t = useT()
      const [page, setPage] = React.useState({ status: 'loading' })
      const [ticket, setTicket] = React.useState(undefined)

      const look = React.useCallback(async () => {
        try {
          const found = await newestPage()
          setPage(found === undefined ? { status: 'empty' } : { status: 'ready', ...found })
        } catch (error) {
          setPage({ status: 'failed', message: error.message })
        }
      }, [])

      React.useEffect(() => { void look() }, [look])

      // Only a page is worth looking again for: the agent writing a Python file
      // does not change what is on this canvas.
      React.useEffect(() => workspaceWatch.subscribe((change) => {
        if (change.stale === true || /\.html?$/i.test(change.path)) void look()
      }), [look])

      // One ticket for the tab, not one per reload: it outlives several
      // rewrites of the page it is showing.
      React.useEffect(() => {
        let live = true
        mintTicket().then(
          (value) => { if (live) setTicket(value) },
          () => { if (live) setTicket(undefined) },
        )
        return () => { live = false }
      }, [])

      if (page.status === 'loading') return h('div', { className: `${NS}-placeholder` }, t('canvas.looking'))
      if (page.status === 'failed') return h('div', { className: `${NS}-placeholder` }, page.message)
      if (page.status === 'empty') {
        return h('div', { className: `${NS}-placeholder` },
          h('div', null, t('canvas.none')),
          h('div', null, t('canvas.none.note')))
      }
      if (ticket === undefined) return h('div', { className: `${NS}-placeholder` }, t('preview.preparing'))

      return h('div', { className: `${NS}-file` },
        h('div', { className: `${NS}-crumbs` },
          h('div', { className: `${NS}-crumb-path`, title: page.path },
            h('span', { className: `${NS}-crumb-name` }, page.path)),
          h('button', {
            type: 'button',
            className: `${NS}-icon-button`,
            title: t('reload'),
            'aria-label': t('reload'),
            // Bumping the modified stamp remounts the frame below, which is a
            // fresh fetch: the route answers `no-store`.
            onClick: (event) => {
              turn(event.currentTarget)
              setPage((current) => ({ ...current, modified: Date.now() / 1000 }))
            },
            onAnimationEnd: (event) => { event.currentTarget.removeAttribute('data-turning') },
          }, icon('refresh', 15))),
        // Keyed by path AND by write time, so a rewritten page is a new frame
        // rather than a stale one. The URL itself stays clean, which is what
        // keeps the page's own relative assets resolving.
        h('iframe', {
          key: `${page.path}:${String(page.modified)}`,
          className: `${NS}-frame`,
          src: previewUrl(ticket, page.path),
          sandbox: 'allow-scripts allow-popups allow-downloads allow-modals',
          title: basename(page.path),
        }),
      )
    }


    /**
     * The menu a row opens, wherever it was opened from.
     *
     * Positioned where it was asked for and clamped to the window, so a row
     * near the bottom edge opens upward instead of off-screen. Dismissed by
     * anything that is not itself: a click elsewhere, Escape, or the panel
     * moving under it.
     *
     * @returns {object|null} the menu, or null when nothing is pointing at anything.
     */
    function RowActions() {
      const t = useT()
      const { menu } = useTree()
      const box = React.useRef(null)
      const [place, setPlace] = React.useState(undefined)

      React.useEffect(() => {
        if (menu === undefined) { setPlace(undefined); return undefined }
        const dismiss = (event) => {
          if (box.current?.contains(event.target) === true) return
          treeStore.closeMenu()
        }
        const onKey = (event) => { if (event.key === 'Escape') treeStore.closeMenu() }
        // Capture, so a click anywhere closes this before that click does
        // whatever else it was going to do.
        document.addEventListener('pointerdown', dismiss, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', dismiss, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [menu])

      // Measured after it is drawn, because where it fits depends on how big
      // it turned out to be.
      React.useLayoutEffect(() => {
        if (menu === undefined || box.current === null) return
        const rect = box.current.getBoundingClientRect()
        setPlace({
          left: Math.min(menu.x, window.innerWidth - rect.width - 8),
          top: menu.y + rect.height > window.innerHeight - 8 ? menu.y - rect.height - 8 : menu.y,
        })
      }, [menu])

      if (menu === undefined) return null
      const { entry } = menu
      const item = (label, onSelect, danger) => h('button', {
        type: 'button',
        role: 'menuitem',
        className: `${NS}-menu-item`,
        'data-danger': danger === true ? '' : undefined,
        onClick: onSelect,
      }, label)

      // Where a new thing would go: inside the directory that was pointed at,
      // beside the file that was, and in the workspace itself when the pointer
      // was on none of them.
      const into = entry === undefined ? ROOT : entry.directory ? entry.path : entry.path.slice(0, entry.path.lastIndexOf('/')) || ROOT

      return h('div', {
        ref: box,
        role: 'menu',
        className: `${NS}-menu`,
        style: { left: `${String(place?.left ?? menu.x)}px`, top: `${String(place?.top ?? menu.y)}px` },
      },
      item(t('menu.create'), () => treeStore.ask({ kind: 'create', into })),
      item(t('menu.mkdir'), () => treeStore.ask({ kind: 'mkdir', into })),
      // The rest is about a particular thing, so it is there only when the
      // pointer was on one.
      entry === undefined ? null : h(React.Fragment, null,
        h('div', { className: `${NS}-menu-sep` }),
        item(t('menu.rename'), () => treeStore.ask({ kind: 'rename', entry })),
        item(t('menu.delete'), () => treeStore.ask({ kind: 'delete', entry }), true)))
    }

    /**
     * What the panel asks before it changes something.
     *
     * Ours rather than `prompt` and `confirm`. Those are the platform's, they
     * look like the platform's, and beside an interface built out of this
     * app's own tokens they read as something else breaking in — which is
     * exactly the wrong signal for the one gesture that deletes a tenant's
     * work. This is also the only place in the panel that can say which file,
     * in the deployment's own voice.
     *
     * @returns {object|null} the dialog, or null when nothing is being asked.
     */
    function AskDialog() {
      const t = useT()
      const { ask } = useTree()
      const [value, setValue] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(undefined)
      const field = React.useRef(null)

      React.useEffect(() => {
        if (ask === undefined) return
        setFailed(undefined)
        setBusy(false)
        setValue(ask.kind === 'rename' ? ask.entry.name : '')
        // Focused on open, and the name selected without its extension, which
        // is the part a rename usually changes.
        window.setTimeout(() => {
          const input = field.current
          if (input === null || input === undefined) return
          input.focus()
          const dot = input.value.lastIndexOf('.')
          input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
        }, 0)
      }, [ask])

      React.useEffect(() => {
        if (ask === undefined) return undefined
        const onKey = (event) => { if (event.key === 'Escape') treeStore.answered() }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey) }
      }, [ask])

      if (ask === undefined) return null
      const { kind, entry, into } = ask
      const parent = entry === undefined ? into : entry.path.slice(0, entry.path.lastIndexOf('/')) || ROOT

      const run = async () => {
        setBusy(true)
        setFailed(undefined)
        try {
          if (kind === 'delete') {
            await command('remove', { path: entry.path })
            // Straight away, rather than waiting for the viewer to ask for a
            // file and be told it is not there. This is the one case where
            // exactly what went is already known, so nothing has to be
            // discovered — and a tab that is only closed once its contents
            // fail shows the failure first.
            store.forget(entry.path)
          }
          else if (kind === 'rename') await command('move', { from: entry.path, to: `${parent}/${value.trim()}` })
          else if (kind === 'mkdir') await command('mkdir', { path: `${into}/${value.trim()}` })
          else await command('create', { path: `${into}/${value.trim()}` })
          // Re-read the directory that changed, and open it, so what was just
          // made is visible rather than merely made.
          treeStore.load(kind === 'delete' || kind === 'rename' ? parent : into)
          if (kind === 'mkdir' || kind === 'create') treeStore.reveal(into, true)
          treeStore.answered()
        } catch (error) {
          setFailed(error.message)
          setBusy(false)
        }
      }

      const named = kind !== 'delete'
      const bad = named && (value.trim() === '' || value.includes('/'))

      return h('div', { className: `${NS}-mask`, onPointerDown: (event) => { if (event.target === event.currentTarget) treeStore.answered() } },
        h('div', { className: `${NS}-dialog`, role: 'dialog', 'aria-modal': 'true' },
          h('div', { className: `${NS}-dialog-title` },
            t(`ask.${kind}`)),
          h('div', { className: `${NS}-dialog-body` },
            kind === 'delete'
              ? t(entry.directory ? 'ask.delete.directory' : 'ask.delete.file', { name: entry.name })
              : h('input', {
                ref: field,
                className: `${NS}-dialog-input`,
                value,
                placeholder: t(kind === 'mkdir' ? 'ask.name.folder' : kind === 'create' ? 'ask.name.file' : 'ask.name.new'),
                'aria-label': t(kind === 'mkdir' ? 'ask.name.folder' : kind === 'create' ? 'ask.name.file' : 'ask.name.new'),
                onChange: (event) => setValue(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter' && !bad && !busy) void run() },
              })),
          // A name, not a path: a rename that could carry a separator would be
          // a move, and a move to somewhere unnamed is how a file disappears
          // from the tree it was renamed in.
          named && value.includes('/') ? h('div', { className: `${NS}-dialog-note` }, t('ask.noslash')) : null,
          failed === undefined ? null : h('div', { className: `${NS}-dialog-note`, 'data-danger': '' }, failed),
          h('div', { className: `${NS}-dialog-actions` },
            h('button', { type: 'button', className: `${NS}-dialog-button`, onClick: () => treeStore.answered() }, t('ask.cancel')),
            h('button', {
              type: 'button',
              className: `${NS}-dialog-button`,
              'data-primary': '',
              'data-danger': kind === 'delete' ? '' : undefined,
              disabled: busy || bad,
              onClick: () => { void run() },
            }, t(busy ? 'ask.busy' : kind === 'delete' ? 'ask.delete' : 'ask.confirm')))))
    }

    /**
     * A shell in the tenant's sandbox.
     *
     * The renderer is xterm, bundled into this package rather than taken from
     * the shell's module table, which does not carry it. What it is given is a
     * WebSocket that carries base64 in both directions: output as it arrives,
     * keystrokes as they are typed, and the terminal's measured size whenever
     * it changes.
     *
     * The socket IS the session. Leaving the tab kills the shell rather than
     * leaving one running that nothing can see — a terminal that outlives its
     * window is a process nobody can stop.
     *
     * @returns {object} the element.
     */
    function Console() {
      const t = useT()
      const host = React.useRef(null)
      const [state, setState] = React.useState({ status: 'opening' })

      React.useEffect(() => {
        const node = host.current
        if (node === null) return undefined

        const term = new Terminal({
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          cursorBlink: true,
          // Reads the theme rather than restating it, so the terminal is the
          // same dark or light the rest of the panel is.
          theme: (() => {
            const read = (name) => getComputedStyle(document.body).getPropertyValue(name).trim()
            return {
              background: read('--dsw-alias-bg-layer-1') || '#1b1b1c',
              foreground: read('--dsw-alias-label-primary') || '#e6e6e6',
              cursor: read('--dsw-alias-label-primary') || '#e6e6e6',
            }
          })(),
          scrollback: 5000,
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(node)

        /**
         * Fit the terminal to its box, if the box has one yet.
         *
         * Guarded, and this is not defensive dressing: fitting a container
         * that has not been laid out divides by a zero cell count and throws.
         * The first version fitted straight after `open`, above the line that
         * opens the socket — so on the frame where the panel had just been
         * created, the terminal rendered and then never connected to
         * anything, with no error anywhere to say why.
         */
        const refit = () => {
          try {
            fit.fit()
            return true
          } catch {
            return false
          }
        }

        const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sandbox/pty`)
        const send = (message) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
        }

        const encoder = new TextEncoder()
        const typed = term.onData((data) => {
          const bytes = encoder.encode(data)
          let binary = ''
          for (const byte of bytes) binary += String.fromCharCode(byte)
          send({ type: 'in', data: btoa(binary) })
        })

        socket.addEventListener('open', () => {
          // Fitted once the browser has laid the panel out, not during the
          // effect that created it.
          requestAnimationFrame(() => {
            refit()
            send({ type: 'size', cols: term.cols, rows: term.rows })
          })
        })
        socket.addEventListener('message', (event) => {
          let message
          try { message = JSON.parse(event.data) } catch { return }
          if (message.type === 'out') {
            const binary = atob(message.data)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
            term.write(bytes)
            return
          }
          if (message.type === 'ready') { setState({ status: 'open' }); return }
          if (message.type === 'error') { setState({ status: 'failed', message: message.message }); return }
          if (message.type === 'exit') setState({ status: 'closed' })
        })
        socket.addEventListener('close', () => { setState((current) => (current.status === 'failed' ? current : { status: 'closed' })) })
        socket.addEventListener('error', () => { setState({ status: 'failed', message: say()('terminal.unreachable') }) })

        // The pty has to be told the size, or a full-screen program draws to
        // the wrong one. Observed rather than listened for on the window: the
        // panel is resized by dragging its edge, which the window never hears
        // about.
        // Next frame, not inside the callback. `refit` resizes the terminal,
        // which resizes the very node being observed, and a mutation made
        // during delivery is what produces the loop warning. A frame later the
        // observation cycle has finished and the resize is an ordinary one.
        let pending
        const observer = new ResizeObserver(() => {
          if (pending !== undefined) return
          pending = requestAnimationFrame(() => {
            pending = undefined
            if (!refit()) return
            send({ type: 'size', cols: term.cols, rows: term.rows })
          })
        })
        observer.observe(node)

        return () => {
          if (pending !== undefined) cancelAnimationFrame(pending)
          observer.disconnect()
          typed.dispose()
          socket.close()
          term.dispose()
        }
      }, [])

      return h('div', { className: `${NS}-console` },
        h('div', { className: `${NS}-console-screen`, ref: host }),
        state.status === 'open' || state.status === 'opening'
          ? null
          : h('div', { className: `${NS}-console-note` },
            state.status === 'failed' ? state.message : t('terminal.over')),
      )
    }

    /**
     * The panel's toggle, as it appears in the session header.
     *
     * One home, in both states. The first version put it inside the panel when
     * open and floated it in the corner when closed, which meant the control
     * moved every time it was used — and in the corner it sat on top of the
     * header's own Session log button. Here it is a sibling of that button in
     * the header's utilities, so it has a fixed place and nothing to collide
     * with; the flex row that holds them both does the spacing.
     *
     * Mounting also tells the store a header exists, which is how the panel
     * knows to stop drawing the fallback in the corner, and publishes the
     * header's measured height so the panel's tab bar can match it. Both read
     * the app's own lifecycle rather than watching the DOM for it.
     * @returns {object} the element.
     */
    function Toggle() {
      const t = useT()
      const { open } = useStore()
      const ref = React.useRef(null)

      React.useEffect(() => {
        store.write({ header: true })
        const header = ref.current?.closest('header')
        const root = document.documentElement
        let observer
        if (header !== null && header !== undefined) {
          const publish = () => {
            const height = Math.round(header.getBoundingClientRect().height)
            // Zero is not a height, it is an absence: the app has switched to a
            // view that does not draw this header, and the element is still
            // there measuring nothing. Publishing it collapsed the panel's tab
            // bar to no height at all — the panel stayed open and kept showing
            // the file, while every control in that bar went off the screen,
            // including the only one that could close it.
            //
            // The last real height stands instead. A stale one is off by a few
            // pixels; a zero is a panel with no way out.
            if (height <= 0) return
            const next = `${height}px`
            if (root.style.getPropertyValue(HEADER_HEIGHT_VAR) === next) return
            root.style.setProperty(HEADER_HEIGHT_VAR, next)
          }
          publish()
          observer = new ResizeObserver(publish)
          observer.observe(header)
        }
        return () => {
          observer?.disconnect()
          root.style.removeProperty(HEADER_HEIGHT_VAR)
          store.write({ header: false })
        }
      }, [])

      // A wrapper that lays out as nothing, so the seat still has an element
      // to measure the header from once the button itself is gone. `display:
      // contents` keeps it out of the row's spacing entirely.
      return h('span', { ref, style: { display: 'contents' } },
        // Only while the panel is closed. Open, this control has moved: it is
        // the same button, drawn at the panel's own right edge, which is where
        // the hand already is once the panel is what you are looking at.
        open ? null : h('button', {
          type: 'button',
          className: `${NS}-toggle`,
          title: t('panel.reveal'),
          'aria-label': t('panel.reveal'),
          onClick: () => store.write({ open: true }),
        }, icon('panel')))
    }

    /**
     * Catches a render failure and says what it was.
     *
     * Without this a thrown render unmounts the whole root, and the panel
     * becomes an empty element on the page: no error visible, nothing to click,
     * nothing in the interface that admits anything happened. A strip naming
     * the failure is worth more than a correct-looking blank.
     */
    class Boundary extends React.Component {
      /**
       * @param {object} props - children to render.
       */
      constructor(props) {
        super(props)
        this.state = { message: undefined }
      }

      /**
       * @param {Error} error - what was thrown.
       * @returns {{message: string}} the state that shows it.
       */
      static getDerivedStateFromError(error) {
        return { message: String(error?.message ?? error) }
      }

      /**
       * @param {Error} error - what was thrown.
       * @param {object} info - React's component stack.
       */
      componentDidCatch(error, info) {
        console.error('[dsh-artifact-panel] render failed:', error, info?.componentStack)
      }

      /** @returns {object} the children, or the failure. */
      render() {
        if (this.state.message === undefined) return this.props.children
        return h('div', { className: `${NS}-crash` },
          // `say()`, not the hook: this is a class component, where hooks are
          // not allowed — and it is the component that runs when everything
          // else has already thrown, so it must not be the thing that throws.
          h('strong', null, say()('crashed')),
          h('span', null, this.state.message))
      }
    }

    /**
     * The panel.
     *
     * Holds the whole of the panel's own state, which is small on purpose:
     * whether it is open, how wide, which tabs exist per session and which one
     * is showing. None of it is persisted — the panel opens at its default
     * width every reload. Where it would live is settled (the plugin's own
     * settings, read before the first mount with a timeout so a stalled
     * settings route cannot keep the panel from appearing); what is not
     * settled is whether a tab list is worth restoring at all, which is a
     * product question and not a plumbing one.
     * @returns {object} the element.
     */
    function Panel() {
      const t = useT()
      const state = useStore()
      const { open, header } = state
      const { tabs, activeId } = state.groups[state.session] ?? EMPTY_GROUP
      const [width, setWidth] = React.useState(DEFAULT_WIDTH)
      // Maximised is a mode, not a width: the width it implies depends on the
      // window and on how wide the tenant has dragged their own sidebar, both
      // of which change under it. Storing the mode and deriving the width each
      // time is what keeps it right after a resize.
      const [maximised, setMaximised] = React.useState(false)

      /**
       * Everything the frame has except the tenant's own sidebar.
       *
       * Measured rather than assumed: the sidebar is draggable between 280 and
       * 420, and it collapses to a 56px rail. Reading the columns is the only
       * answer that stays true through all of that.
       *
       * @returns {number|undefined} the width to take, or undefined when the frame is not there.
       */
      const roomBesideSidebar = React.useCallback(() => {
        const frame = document.querySelector('#root > [data-slot="root"] > div')
        const rail = frame?.children[0]
        if (frame === null || frame === undefined || rail === undefined) return undefined
        return Math.round(frame.getBoundingClientRect().width - rail.getBoundingClientRect().width)
      }, [])

      // Hand the width to the layout. Written on the document element rather
      // than passed down, because the element that gives up the space is
      // `#root` — the app's, not ours.
      React.useEffect(() => {
        const root = document.documentElement
        const apply = () => {
          const taken = maximised ? (roomBesideSidebar() ?? width) : width
          const next = open ? `${String(taken)}px` : '0px'
          // Only when it actually changed. This value is written INTO the box
          // the observer below is watching — it sets the margin that gives the
          // conversation its width — so writing it unconditionally means every
          // notification produces another one. The browser calls that
          // "ResizeObserver loop completed with undelivered notifications",
          // and the second pass is always computing the number it already has.
          if (root.style.getPropertyValue(WIDTH_VAR) === next) return
          root.style.setProperty(WIDTH_VAR, next)
        }
        apply()
        // While maximised the width is the window's, so it has to be recomputed
        // when the window changes — and when the tenant drags their sidebar,
        // which the frame's own resize reports too.
        if (!open || !maximised) return () => { root.style.removeProperty(WIDTH_VAR) }
        const frame = document.querySelector('#root > [data-slot="root"] > div')
        const observer = frame === null ? undefined : new ResizeObserver(apply)
        if (frame !== null) observer?.observe(frame)
        return () => {
          observer?.disconnect()
          root.style.removeProperty(WIDTH_VAR)
        }
      }, [open, width, maximised, roomBesideSidebar])

      // A window narrow enough to violate the ceiling re-clamps the panel
      // rather than letting it eat the conversation.
      React.useEffect(() => {
        const onResize = () => { setWidth((current) => clampWidth(current)) }
        window.addEventListener('resize', onResize)
        return () => { window.removeEventListener('resize', onResize) }
      }, [])

      /**
       * Open a tab, or focus the one already showing that thing.
       *
       * Deduplicated by id, which for a produced file will be its path: the
       * same file produced in five turns is one tab, not five.
       */
      const openTab = React.useCallback((tab) => {
        store.openTab(tab)
        store.write({ open: true })
      }, [])

      /** Opening a file from the tree, wherever the tree is being shown. */
      const openFile = React.useCallback((entry) => {
        openTab({ id: entry.path, label: entry.name, path: entry.path, icon: iconFor(entry.path) })
      }, [openTab])

      const closeTab = React.useCallback((id) => { store.closeTab(id) }, [])

      // The drag. Pointer capture rather than window listeners, so a pointer
      // that leaves the window mid-drag still delivers its move and release;
      // the body attribute suspends the layout transition so the frame tracks
      // the pointer instead of chasing it.
      const onGripDown = React.useCallback((event) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = width
        const target = event.currentTarget
        target.setPointerCapture(event.pointerId)
        document.body.setAttribute(DRAGGING, '')
        const onMove = (move) => { setWidth(clampWidth(startWidth + (startX - move.clientX))) }
        const onUp = () => {
          document.body.removeAttribute(DRAGGING)
          target.removeEventListener('pointermove', onMove)
          target.removeEventListener('pointerup', onUp)
          target.removeEventListener('pointercancel', onUp)
        }
        target.addEventListener('pointermove', onMove)
        target.addEventListener('pointerup', onUp)
        target.addEventListener('pointercancel', onUp)
      }, [width])

      // The toggle's home is the session header. Before a session exists there
      // is no header to live in, so the corner — empty in that state — stands
      // in. Rendered only then, which keeps it off the header's own controls
      // once a session opens.
      //
      // It toggles rather than only opens, and it is drawn in BOTH states. The
      // first version rendered it only while the panel was closed, which on the
      // no-session screen left an open panel with nothing anywhere that could
      // close it.
      const corner = header || open ? null : h('button', {
        type: 'button',
        className: `${NS}-opener`,
        title: t('panel.reveal'),
        'aria-label': t('panel.reveal'),
        onClick: () => store.write({ open: true }),
      }, icon('panel'))

      if (!open) return corner

      const active = tabs.find((tab) => tab.id === activeId)
      return h(React.Fragment, null, corner,
        h('div', {
          className: `${NS}-panel`,
          // Reads the variable rather than the state, so the maximised width —
          // which is derived from the frame — and the pushed-aside column are
          // never two different numbers.
          style: { width: `var(${WIDTH_VAR}, ${String(width)}px)` },
        },
        maximised ? null : h('div', { className: `${NS}-grip`, onPointerDown: onGripDown }),
        h(TabBar, {
          tabs,
          activeId,
          onSelect: (id) => store.select(id),
          onClose: closeTab,
          onNew: () => store.select(undefined),
          onOpen: (tool) => openTab({ id: tool.id, icon: tool.icon }),
          onCollapse: () => store.write({ open: false }),
          onMaximise: () => setMaximised((current) => !current),
          maximised,
        }),
        h('div', { className: `${NS}-body` },
          active === undefined
            ? h(EmptyState, { open: tabs, onOpen: (tool) => openTab({ id: tool.id, icon: tool.icon }) })
            // A tab is either one of the tools or one file. The file's path is
            // its id, which is what makes opening the same file twice open one
            // tab.
            : active.path !== undefined || active.id === 'files'
              ? h(WorkspacePane, { key: active.id, path: active.path, onOpen: openFile })
              : active.id === 'canvas'
                ? h(Canvas, null)
                : active.id === 'terminal'
                  ? h(TerminalPane, null)
                  : h(Placeholder, { tab: active })),
        h(RowActions, null),
        h(AskDialog, null),
      ))
    }

    return {
      inject: ['slots', 'workspaces', 'sessions', 'locale'],

      /**
       * Mount the browser half.
       * @param {object} ctx - the client context, carrying the slot registry.
       */
      apply(ctx) {
        plugin = ctx

        // Before any seat renders, or a seat renders its keys.
        ctx.effect(
          () => ctx.locale.register(LOCALE_NS, DICTIONARY),
          'artifact-panel: dictionaries',
        )

        // The styles go in once, beside the panel rather than inside it, so
        // the rule that pushes `#root` survives the panel being closed.
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-artifact-panel-style', '')
          // xterm's own rules first: they position the canvas layers and the
          // cursor, and nothing here should have to restate them.
          style.textContent = `${terminalCss}\n${CSS}`
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'artifact-panel: styles')

        // The panel's own root, created and torn down with this effect so a
        // disposal leaves neither a live root nor an orphaned host behind for
        // the next mount to find.
        ctx.effect(() => {
          const host = document.createElement('div')
          host.setAttribute(ANCHOR, '')
          document.body.appendChild(host)
          const root = ReactDomClient.createRoot(host)
          window.__panelBoot.rootMade = true
          try {
            root.render(h(Boundary, null, h(Panel)))
            window.__panelBoot.rendered = true
          } catch (error) {
            window.__panelBoot.renderThrew = String(error && error.message)
            throw error
          }
          return () => {
            // Asynchronously, because unmounting a root from inside a React
            // render or commit is what React refuses; the effect can run in
            // either.
            setTimeout(() => {
              root.unmount()
              host.remove()
            }, 0)
          }
        }, 'artifact-panel: mount the panel')

        // Follow the app's current session, so tabs opened while reading one
        // conversation are the tabs that come back when it is read again.
        ctx.effect(() => {
          const feed = ctx.sessions.list
          const follow = () => { store.setSession(feed.getSnapshot().current) }
          follow()
          return feed.subscribe(follow)
        }, 'artifact-panel: follow the current session')

        // Take over opening a file.
        //
        // `ctx.workspaces.openPath` is the one door every file open in the
        // conversation goes through — a path link in a tool row, the produced
        // files at the end of a turn, a file mentioned in prose: `ui-conversation`
        // resolves each against the session's cwd and calls this. Its default is
        // to hand the path to the host operating system, which in a sandbox
        // reached through a browser is a request to open a file on a machine
        // nobody is sitting at. Wrapping the one method reroutes all three
        // sources at once; there is nothing to wire up per source.
        ctx.effect(() => {
          const workspaces = ctx.workspaces
          // The RAW method, never a bound copy. Several plugins may wrap this
          // one method, and only restoring exactly what was found keeps a
          // chain of them unbroken however the unloads interleave.
          const original = workspaces.openPath
          workspaces.openPath = (path) => {
            // Every path, not only the ones under the workspace.
            //
            // Calling through used to be the polite answer for a path this
            // could not show. It is not an answer here at all: the default
            // hands the path to the host operating system, and the host is a
            // container reached through a browser — there is no desktop and
            // no `xdg-open`, ever. So the fallthrough could only ever produce
            // `spawn xdg-open ENOENT`, and it did, for exactly the files a
            // person is most likely to click: the ones the agent just wrote
            // somewhere like `/tmp`.
            //
            // Reading is not scoped to the workspace — the gateway serves any
            // path in the sandbox, because the tenant is root in there and
            // refusing protects nothing. What stays scoped is the tree, which
            // is why an outside path opens without being revealed in it.
            if (typeof path === 'string' && path.startsWith('/')) {
              store.openTab({ id: path, label: basename(path), path, icon: iconFor(path) })
              store.write({ open: true })
              // The callers ignore the result; resolving says "handled".
              return Promise.resolve()
            }
            // Anything that is not an absolute path is not a file open this
            // understands, and the harness may know what to do with it.
            return original.call(workspaces, path)
          }
          return () => { workspaces.openPath = original }
        }, 'artifact-panel: open files in the panel')

        // The toggle takes a real seat, because one exists: the header's
        // utilities row is a declared slot, and the Session log button is
        // already in it. Nothing here touches the app's DOM.
        ctx.effect(
          () => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
            { name: 'conversation.session.header.utilities', id: 'artifact-panel-toggle', order: 10 },
            Toggle,
          )),
          'artifact-panel: the toggle in the session header',
        )
      },
    }
  },
})
