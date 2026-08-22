/**
 * The console's sections, in the order the rail shows them.
 *
 * Adding one is this list plus a file. Nothing in the shell, the router or the
 * gates enumerates sections anywhere else — which is the whole reason the
 * single-column page was taken apart.
 *
 * The order is the order an operator meets them: who is here, how they get
 * here, what the deployment does, what guards this console, and what has been
 * done to it.
 *
 * @module sections/index
 */

import * as tenants from './tenants.js'
import * as invites from './invites.js'
import * as settings from './settings.js'
import * as security from './security.js'
import * as audit from './audit.js'

/**
 * One section.
 *
 * @typedef {object} Section
 * @property {string} id - its name in the rail, in a URL, and in a string key.
 * @property {string} path - the route it answers on.
 * @property {string} icon - the glyph beside it, from `dsh-icons`.
 * @property {{zh: string, en: string}} label - what the rail calls it.
 * @property {{zh: string, en: string}} lede - the sentence under its heading.
 * @property {Record<string, {zh: string, en: string}>} strings - everything its markup names.
 * @property {(state: object) => {html: string, table?: object}} render - its markup, and any sentence it words at render time.
 * @property {string[]} needs - what the router has to read before rendering it.
 */

/** @type {Section[]} */
export const SECTIONS = [
  { id: 'tenants', path: '/', needs: ['accounts'], ...tenants },
  { id: 'invites', path: '/invites', needs: ['invites'], ...invites },
  { id: 'settings', path: '/settings', needs: ['access', 'credential'], ...settings },
  { id: 'security', path: '/security', needs: ['security'], ...security },
  { id: 'audit', path: '/audit', needs: ['audit'], ...audit },
]

/**
 * The section one path belongs to.
 *
 * @param {string} path - the request path.
 * @returns {Section|undefined} the section, or nothing.
 */
export function sectionFor(path) {
  return SECTIONS.find((section) => section.path === path)
}
