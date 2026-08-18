/**
 * Bundle the panel's browser half.
 *
 * This is the first package here with a build step, and it exists for one
 * reason: the terminal needs a renderer. ANSI parsing, a scrollback, a cursor
 * and selection are not things to reimplement, and the shell's module table
 * carries React and nothing else this could use. So xterm has to come from
 * somewhere.
 *
 * It comes from inside this package, bundled, rather than from a file placed
 * in the deployment's web image. Serving it as a static asset would have
 * worked and would have needed no bundler — and it would have made this a
 * plugin that only runs where somebody has already put xterm next to the
 * shell. A plugin that cannot be handed to another dsh deployment is not
 * really a plugin.
 *
 * What is NOT bundled is anything the shell already provides. The source calls
 * `require('react')` and friends, but that `require` is the parameter of the
 * factory `__ModuleLoader__.load` hands in — a local binding, not the
 * CommonJS one — so the bundler leaves it alone, and React stays the shell's
 * single copy rather than a second one shipped in here.
 *
 * Output is `lib/client.js`, which `package.json` names as the client entry.
 * It is not committed: it is derived, and the thing to read is `src/`.
 *
 * Run: npm run build
 */

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const here = path.dirname(fileURLToPath(import.meta.url))

const result = await build({
  entryPoints: [path.join(here, 'src/client.js')],
  outfile: path.join(here, 'lib/client.js'),
  bundle: true,
  // An IIFE, because the client registry evaluates this file as a script and
  // the file's own job is to call `__ModuleLoader__.load` once.
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  // Readable in a browser's sources pane. This is a panel, not a hot path, and
  // being able to read what is running is worth more than the bytes.
  minify: false,
  legalComments: 'inline',
  define: { 'process.env.NODE_ENV': '"production"' },
  // xterm's stylesheet arrives as a string the panel injects, so the plugin
  // stays one file — the registry serves exactly one per plugin.
  loader: { '.css': 'text' },
  logLevel: 'info',
})

if (result.errors.length > 0) process.exit(1)
