/**
 * The deployment's one store.
 *
 * Everything the gateway keeps lives here: who has an account, which invites
 * exist, which refresh tokens are live, and which sign-in codes are outstanding.
 * Redis held all of it before and was removed rather than kept alongside —
 * nothing was left in it once accounts had to be durable, and a second store
 * would have meant a second backup, a second failure mode, and two answers to
 * "is this deployment's data safe" instead of one.
 *
 * Sign-in codes are the only short-lived rows, and they expire by a column
 * rather than by the store: every read filters on `expires_at`, so a row that
 * outlived its use is already invisible, and the sweep below is housekeeping
 * rather than correctness.
 *
 * The schema is applied at startup. It is small enough that the whole of it is
 * here, and it is written to be applied to a database that already has it —
 * there is no migration history to reason about because there has not yet been a
 * release to be compatible with.
 */

import process from 'node:process'
import pg from 'pg'

/** How often expired sign-in codes are swept. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000

/**
 * The schema, applied on every boot.
 *
 * `accounts.id` is what a tenant's durable state is named by, so it is generated
 * here and never derived from the address: an address deleted and registered
 * again has to be a different tenant, or it would inherit the previous holder's
 * files.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id           uuid        PRIMARY KEY,
  email        text        NOT NULL UNIQUE,
  disabled     boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- What a tenant calls themselves and what they look like, both chosen by them
-- and neither known until they have been through the profile page. The avatar
-- is a whole data: URI rather than bytes and a type, because every reader of it
-- puts it straight into an img element and would otherwise have to reassemble
-- one; it is bounded on write, and there is no object store here to bound it.
--
-- (No backticks in here: this string is a template literal, and one would end
-- the schema early — which fails at boot, on the statement after it.)
--
-- Null is the answer for an account that has never set them, which is also what
-- the shell's gate reads to decide whether a tenant has been asked yet.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar text;

-- Cascades from the account: a deleted account must not leave a token that
-- still renews, and the database is a better place to guarantee that than a
-- sequence of calls that can be interrupted halfway.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token      text        PRIMARY KEY,
  email      text        NOT NULL REFERENCES accounts(email) ON DELETE CASCADE ON UPDATE CASCADE,
  expires_at timestamptz NOT NULL
);

-- What a spent token was replaced by, and when. A rotated token is kept for a
-- grace period rather than deleted, because a browser waking from the
-- background asks several times at once with the same one: the first rotation
-- would win and every other request would be told its token is unknown.
--
-- Within the grace period a spent token answers with its replacement, so those
-- requests all succeed and all end up holding the same new token. Presented
-- after it, or when it names no replacement, it is a token being replayed.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by text;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS spent_at timestamptz;
CREATE INDEX IF NOT EXISTS refresh_tokens_spent ON refresh_tokens (spent_at) WHERE spent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS refresh_tokens_email ON refresh_tokens (email);

-- One outstanding challenge per address, holding both the code and the rate
-- limit: they are the same fact seen twice, and separate rows could disagree.
CREATE TABLE IF NOT EXISTS challenges (
  email          text        PRIMARY KEY,
  code           text        NOT NULL,
  attempts       integer     NOT NULL DEFAULT 0,
  expires_at     timestamptz NOT NULL,
  cooldown_until timestamptz NOT NULL
);

-- Deployment-wide configuration an administrator can change without a redeploy.
-- The model credential lives here rather than only in the environment, so that
-- rotating it is a form submission instead of an edit-and-restart — and so the
-- gateway reads the current one when it starts a sandbox rather than the one it
-- happened to boot with.
CREATE TABLE IF NOT EXISTS settings (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- Environment a tenant asks for in their own sandbox.
--
-- Values are secrets in the ordinary sense — an API key for something the agent
-- should reach — so they are written here and never read back to a browser:
-- what the settings page shows is the name and when it changed. Cascading from
-- the account matters more than usual, because a row that outlived its owner
-- would be injected into whoever registered that address next.
CREATE TABLE IF NOT EXISTS sandbox_secrets (
  email      text        NOT NULL REFERENCES accounts(email) ON DELETE CASCADE ON UPDATE CASCADE,
  name       text        NOT NULL,
  value      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, name)
);

-- Redeemed rather than deleted, so an operator can see who used which invite.
CREATE TABLE IF NOT EXISTS invites (
  code        text        PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  redeemed_at timestamptz,
  redeemed_by text
);
`

/**
 * Connect to the database, apply the schema, and start the sweep.
 *
 * Connected before the server listens: a gateway that cannot reach its store can
 * authenticate nobody, and starting anyway would answer every request with a
 * login page for no stated reason.
 *
 * @returns {Promise<import('pg').Pool>} the connected pool.
 * @throws {Error} when the database cannot be reached or the schema cannot be applied.
 */
export async function connect() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://dsh:dsh@postgres:5432/dsh',
    // An idle client that the database or a proxy has already dropped fails the
    // next query rather than the connection; keeping the pool small and its
    // clients short-lived is cheaper than detecting that.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  })
  // Errors on an idle client reach the pool rather than a caller, and an
  // unhandled one would take the process down — which for this component means
  // signing everybody out because a connection went away.
  pool.on('error', (error) => { console.error(`gateway: postgres: ${error.message}`) })

  await pool.query(SCHEMA)

  const sweep = setInterval(() => {
    void pool.query('DELETE FROM challenges WHERE expires_at < now()')
      .catch((error) => { console.error(`gateway: sweeping expired codes failed: ${error.message}`) })
    // Rotation keeps a spent token for its grace period rather than deleting
    // it, so unlike before there is something here to clean up: rows past
    // their expiry, and spent ones whose grace has long gone.
    void pool.query(
      `DELETE FROM refresh_tokens
        WHERE expires_at < now()
           OR (spent_at IS NOT NULL AND spent_at < now() - interval '1 hour')`,
    ).catch((error) => { console.error(`gateway: sweeping spent tokens failed: ${error.message}`) })
  }, SWEEP_INTERVAL_MS)
  sweep.unref()

  return pool
}
