/**
 * Every plugin's browser half, actually evaluated.
 *
 * Nothing else here does that. The linter parses, the other checks read the
 * source as text, and only one of these plugins goes through a bundler — so a
 * file can be well-formed, pass every gate, and still throw the moment the
 * shell imports it. That happened: a constant declared below the stylesheet
 * that interpolates it sat in the temporal dead zone, and the whole plugin
 * failed to load with `Cannot access 'SAMPLE_MS' before initialization`.
 *
 * So each plugin is loaded here the way the shell loads it: a stub
 * `__ModuleLoader__` collects the entry, and the factory is called with a
 * `require` that answers with just enough of React for module-scope code to
 * evaluate. What this proves is narrow and worth having — that importing the
 * plugin does not throw, and that it hands back the shape the shell expects.
 * It renders nothing and asserts nothing about behaviour.
 *
 * Run: node scripts/check-plugin-load.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import vm from 'node:vm'

const root = resolve(import.meta.dirname, '..')

/**
 * The file each plugin is served as.
 *
 * The built half where there is one — that is what the shell fetches — and the
 * source otherwise.
 */
function served() {
  const found = []
  for (const name of readdirSync(join(root, 'packages'))) {
    for (const relative of [`packages/${name}/lib/client.js`, `packages/${name}/client.js`]) {
      const file = join(root, relative)
      if (existsSync(file)) { found.push({ name, relative, file }); break }
    }
  }
  return found
}

/**
 * Enough of a browser and a shell for module-scope code to run.
 *
 * Deliberately thin: anything this has to grow to support is something a
 * plugin does at import time, and import time is exactly what is being
 * checked.
 *
 * @returns {{context: object, entries: object[]}} the sandbox and what it collected.
 */
function shell() {
  const entries = []
  const noop = () => undefined
  const element = (type, props, ...children) => ({ type, props, children })
  const react = {
    createElement: element,
    Fragment: 'fragment',
    // An error boundary is a class component, and it is declared at module
    // scope: without this the plugin fails to import with `Class extends value
    // undefined`.
    Component: class Component {},
    PureComponent: class PureComponent {},
    createContext: () => ({ Provider: 'provider', Consumer: 'consumer' }),
    memo: (component) => component,
    forwardRef: (component) => component,
    useState: () => [undefined, noop],
    useEffect: noop,
    useLayoutEffect: noop,
    useMemo: (make) => make(),
    useCallback: (fn) => fn,
    useRef: () => ({ current: undefined }),
    useContext: () => undefined,
    useSyncExternalStore: () => undefined,
    useId: () => 'id',
  }
  const table = {
    react,
    'react-dom': { createPortal: element, flushSync: (fn) => fn() },
    'react-dom/client': { createRoot: () => ({ render: noop, unmount: noop }) },
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' },
  }
  const style = { setAttribute: noop, remove: noop, dataset: {}, textContent: '', appendChild: noop }
  const document = {
    createElement: () => style,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    head: { appendChild: noop },
    body: { appendChild: noop },
    documentElement: { dataset: {} },
  }
  /**
   * A module the shell would provide and this does not.
   *
   * Every name answers with something that can be called, constructed, or
   * extended, because a bundled plugin does all three at module scope and a
   * stub that answered `undefined` would fail on the first of them — telling
   * us about the stub rather than about the plugin.
   */
  const anything = new Proxy(function stub() {}, {
    get: (target, key) => (key === 'default' || typeof key === 'symbol' ? target : anything),
    apply: () => undefined,
    construct: () => ({}),
  })

  const context = {
    console,
    document,
    // `userAgent` because xterm sniffs it at module scope, which is a fair
    // reminder that "enough of a browser" is decided by the dependencies, not
    // by what our own code touches.
    navigator: {
      language: 'zh-CN',
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      platform: 'MacIntel',
      clipboard: { writeText: noop },
    },
    location: { href: 'https://example.invalid/', origin: 'https://example.invalid' },
    localStorage: { getItem: () => null, setItem: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: () => Promise.reject(new Error('not reachable from a check')),
    addEventListener: noop,
    removeEventListener: noop,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    __ModuleLoader__: {
      load: (entry) => {
        entries.push({ ...entry, exports: entry.factory((name) => table[name] ?? anything) })
      },
    },
  }
  context.window = context
  context.globalThis = context
  // Bundled dependencies reach for `self` as often as for `window`.
  context.self = context
  return { context, entries }
}

const problems = []

for (const { name, relative, file } of served()) {
  const source = readFileSync(file, 'utf8')
  // Only the browser halves; a plugin's node half is imported by the gateway
  // and is not what this is about.
  if (!source.includes('__ModuleLoader__')) continue

  const { context, entries } = shell()
  try {
    vm.runInNewContext(source, vm.createContext(context), { filename: relative })
  } catch (error) {
    problems.push(`${relative}: throws on import — ${error.message}`)
    continue
  }

  if (entries.length === 0) {
    problems.push(`${relative}: registered no loader entry`)
    continue
  }
  for (const entry of entries) {
    if (typeof entry.exports?.apply !== 'function') {
      problems.push(`${relative}: its entry exports no apply(), so the shell has nothing to call`)
    }
    if (entry.exports?.inject !== undefined && !Array.isArray(entry.exports.inject)) {
      problems.push(`${relative}: inject is not a list of service names`)
    }
  }
  console.log(`  ${name}: imports cleanly, ${String(entries.length)} entr${entries.length === 1 ? 'y' : 'ies'}`)
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\n${problems.length} problem(s) loading the plugins`)
  process.exit(1)
}

console.log('check-plugin-load: every plugin imports without throwing')
