/**
 * The landing page's build.
 *
 * There was a script here doing this by hand — copying the tree, hashing each
 * asset, and rewriting every reference to it by string substitution. It worked,
 * and it only knew the spellings it had been taught: a reference written a way
 * it did not recognise was left pointing at a name nothing served. This is the
 * job a bundler already does from the parse tree rather than from a guess, so
 * it does it.
 *
 * Two settings carry the constraints the page has always had.
 */

import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(here, '../..')

export default defineConfig({
  // Relative, because the page is served from more than one root: the site root
  // on GitHub Pages and `/` inside the web image. Absolute URLs would name a
  // path that is only right in one of them. This is the same rule the page
  // followed by hand, now enforced by the thing that writes the URLs.
  base: './',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Not `assets/`, which is the shell's: the web image serves the
    // application's bundles from there, and a landing asset of the same name
    // would be answered with a JavaScript bundle. `landing/` belongs to this
    // page alone, so the two cannot collide.
    assetsDir: 'landing',
    // Every asset gets a file of its own, none inlined as a data URI. The
    // document is the one thing served `no-cache` and re-fetched on every
    // visit; inlining an image into it means paying for that image every time,
    // and the hashed file beside it would have been cached forever.
    assetsInlineLimit: 0,
  },

  server: {
    fs: {
      // The marks are the gateway's, named by their real path so that there is
      // one copy of each in the tree rather than a copy per page that shows
      // them. The dev server has to be allowed to read them there.
      allow: [repository],
    },
  },
})
