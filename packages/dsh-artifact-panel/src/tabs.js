/**
 * What a tab bar looks like once something it was showing is gone.
 *
 * Its own file because it is the one part of the tab store that is pure — a
 * function of the groups and a path — and because the cases that matter are
 * the ones nobody produces by hand: a directory taking its contents with it, a
 * file open in a session other than the one on screen, the active tab going
 * while its neighbours stay, and the last tab going at all.
 *
 * @module tabs
 */

/**
 * Whether a tab is showing something at or under a path.
 *
 * The prefix carries the separator with it, so removing `/w/app` does not
 * also close `/w/application.js`. A tab with no path of its own is one of the
 * built-in tools, and no file being removed is about those.
 *
 * @param {{path?: string}} tab - the tab.
 * @param {string} path - what was removed.
 * @returns {boolean} whether the tab was showing it.
 */
export function shows(tab, path) {
  if (typeof tab?.path !== 'string') return false
  return tab.path === path || tab.path.startsWith(`${path}/`)
}

/**
 * Every group with the tabs for one path taken out.
 *
 * All of them, not the current one: a file can be open in more than one
 * session and it is equally gone in each, and forgetting it only where
 * someone happens to be standing leaves the same dead tab to be found later.
 *
 * When the tab that was active goes, focus falls to its left — the position
 * the eye is already at, and the same place closing a tab by hand leaves it.
 * When something other than the active tab goes, focus does not move at all.
 *
 * `changed` is returned rather than compared for by the caller, so a removal
 * that touched nothing costs no write and no render.
 *
 * @param {Record<string, {tabs: Array<object>, activeId?: string}>} groups - every session's tabs.
 * @param {string} path - what was removed.
 * @returns {{groups: Record<string, object>, changed: boolean}} the groups, and whether any differ.
 */
export function forgetPath(groups, path) {
  const next = {}
  let changed = false
  for (const [session, group] of Object.entries(groups)) {
    const tabs = group.tabs.filter((tab) => !shows(tab, path))
    if (tabs.length === group.tabs.length) { next[session] = group; continue }
    changed = true
    const index = group.tabs.findIndex((tab) => shows(tab, path))
    const active = group.tabs.find((tab) => tab.id === group.activeId)
    const activeId = active !== undefined && shows(active, path)
      ? tabs[Math.max(0, index - 1)]?.id
      : group.activeId
    next[session] = Object.freeze({ tabs, activeId })
  }
  return { groups: next, changed }
}
