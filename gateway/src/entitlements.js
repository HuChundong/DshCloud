/**
 * What one account is allowed, resolved into something the runtime can obey.
 *
 * This is the seam between the two planes this deployment will eventually be
 * split along, drawn now while there is nothing commercial behind it.
 *
 * The RUNTIME plane — sign-in, sandboxes, the tunnel, the panel — is what a
 * tenant touches, and it has to work when nothing else is present. It reads
 * entitlements and never writes them, and it makes no commercial judgements of
 * its own: it obeys a conclusion somebody else reached.
 *
 * The COMMERCE plane — who may register, what they are entitled to, what they
 * used, what they owe — does not exist yet. When it does, it supplies this
 * record and nothing else changes: no pricing decision reaches the code every
 * tenant goes through, and no runtime code learns what a subscription is.
 *
 * Until then the table below IS the commerce plane, and that is not a
 * placeholder to be apologised for — it is exactly the shape a self-hosted
 * deployment runs in forever. Somebody running this on their own hardware has
 * no billing, and the way they get "no billing" is that entitlements resolve
 * from a built-in default. Today's deployment proves that path by living on
 * it, rather than promising it and finding out later.
 *
 * ## Nothing here is a promise without a mechanism
 *
 * `plans.js` deliberately holds ids and no capabilities, on the grounds that a
 * capability listed where no code consults it is a promise with no mechanism
 * behind it. The same rule governs this file and is now enforced rather than
 * remembered: `scripts/check-entitlements.mjs` fails on a field declared here
 * that nothing in `gateway/src` reads.
 *
 * That is why this record is short. Machine size, storage ceilings and model
 * spend all belong here eventually and none of them is here today: the first
 * two need a template per tier, the third needs metering, and until those
 * exist a number in this file would be a number nobody obeys.
 *
 * ## What is NOT decided here
 *
 * Whether a deployment is full. That ceiling is about the hardware, not about
 * who is asking, and it stays where it is.
 *
 * @module entitlements
 */

import { DEFAULT_PLAN, normalizePlan } from './plans.js'

/**
 * Every field an entitlement record carries, for the check to hold this file
 * to its own rule. A name added here has to be read somewhere.
 */
export const FIELDS = ['machine', 'idleTtlMs']

/**
 * What each tier is allowed.
 *
 * `undefined` means "whatever this deployment does by default" — not zero, and
 * not unlimited. It is what lets every tier resolve to the behaviour that was
 * in force before this file existed, which is the point of landing the seam
 * separately from any decision about what to charge for.
 *
 * - `machine` names the template a sandbox is built from. Every tier takes the
 *   deployment's own today; a tier that named another would get another size,
 *   and that is one line here rather than a change to the runtime.
 * - `idleTtlMs` is how long an idle sandbox is kept while a browser is still
 *   attached to it.
 */
const BY_PLAN = {
  free: { machine: undefined, idleTtlMs: undefined },
  pro: { machine: undefined, idleTtlMs: undefined },
  team: { machine: undefined, idleTtlMs: undefined },
}

/**
 * The entitlements one account holds.
 *
 * Total, never partial: a caller reads a field and obeys it, and a field that
 * was not decided reads as `undefined` rather than as missing. An unknown tier
 * resolves to the default one for the same reason `normalizePlan` exists — a
 * row written by a newer build must not leave a tenant with no entitlements at
 * all.
 *
 * @param {{plan?: string}|undefined} account - the account, or nothing.
 * @returns {{machine: string|undefined, idleTtlMs: number|undefined}} what they are allowed.
 */
export function entitlementsOf(account) {
  const plan = normalizePlan(account?.plan)
  return { ...BY_PLAN[plan] ?? BY_PLAN[DEFAULT_PLAN] }
}
