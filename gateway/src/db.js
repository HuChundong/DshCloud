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

-- Cascades from the account: a deleted account must not leave a token that
-- still renews, and the database is a better place to guarantee that than a
-- sequence of calls that can be interrupted halfway.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token      text        PRIMARY KEY,
  email      text        NOT NULL REFERENCES accounts(email) ON DELETE CASCADE ON UPDATE CASCADE,
  expires_at timestamptz NOT NULL
);
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
  }, SWEEP_INTERVAL_MS)
  sweep.unref()

  return pool
}
