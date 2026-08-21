/**
 * What a tenant is subscribed to.
 *
 * One table, and it holds ids and nothing else. No display names, because a
 * name has a language and the language is a preference in the tenant's browser
 * that this process has no business knowing — the same argument the account
 * plugin already makes for error codes, applied to the one other thing the
 * gateway names rather than words. No prices, because nothing here charges: a
 * price rendered from a table nobody bills against is a claim the deployment
 * cannot keep. No entitlements, because none are enforced anywhere yet, and a
 * capability listed here that no code consults is a promise with no mechanism
 * behind it.
 *
 * So what this is for is the set itself: which ids exist, which one an account
 * gets when nobody has said otherwise, and one place to add the next tier.
 *
 * `self-hosted` is deliberately absent. The front door shows it as a fourth
 * column beside these three, but no account is ever on it — it is a link to the
 * repository, not a subscription — and a value the database can hold but no
 * tenant can be is a state every reader afterwards has to rule out.
 *
 * @module plans
 */

/**
 * The tiers, in the order they are offered.
 *
 * The order is the page's, not the database's: `free` first because that is
 * where everyone starts, and `team` last because it is the largest. Nothing
 * reads this as a ranking — there is no "at least pro" test anywhere, and there
 * will not be one until entitlements exist to test.
 */
export const PLANS = ['free', 'pro', 'team']

/**
 * What an account is on until somebody says otherwise.
 *
 * Also what the column defaults to, which is why every account that existed
 * before this table did is on it: they were not downgraded, they were named.
 * The badge they used to wear said `预览版`, which was never a tier — it was
 * this deployment admitting it had none.
 */
export const DEFAULT_PLAN = 'free'

/**
 * Whether a string is a tier this deployment offers.
 * @param {unknown} value - the candidate.
 * @returns {boolean} whether it names a tier.
 */
export function isPlan(value) {
  return typeof value === 'string' && PLANS.includes(value)
}

/**
 * Reduce whatever was stored to a tier that exists.
 *
 * A row written by a newer gateway — or by hand — can name a tier this build
 * has never heard of, and the honest answer for a reader who cannot say what
 * something is, is the default rather than the raw value. The browser makes the
 * same move with the name it cannot look up, and for the same reason: a shell
 * running against an unfamiliar deployment should degrade to something plain,
 * not to something raw.
 *
 * @param {unknown} value - the stored tier, or anything else.
 * @returns {string} a tier that exists.
 */
export function normalizePlan(value) {
  return isPlan(value) ? value : DEFAULT_PLAN
}
