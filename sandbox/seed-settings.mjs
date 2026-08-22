/**
 * The provider a tenant finds already configured, written once into their
 * settings.
 *
 * A sandbox starts with dsh's own defaults, which name providers this
 * deployment does not serve and no model it can reach. What a tenant saw on
 * their first visit was a model picker with nothing in it that worked, and the
 * way out was to read the harness's configuration reference and write a
 * provider profile by hand — for a deployment that has exactly one model and
 * already knows everything about it.
 *
 * So the deployment writes it. What is written is a route to this deployment's
 * model gateway and the one model behind it, with the compatibility switches
 * that endpoint actually needs; see `docs/sandbox-pitfalls.md` for what each
 * of them is worth.
 *
 * Two rules keep this from being a thing done TO the tenant:
 *
 * - **Only when the key is absent.** Every block is added only if the settings
 *   document does not already carry its top-level key, so a tenant who has
 *   configured their own providers keeps them, forever, including after this
 *   file changes. The seed is a starting point, not a policy.
 * - **Never a credential.** The profile names an environment variable rather
 *   than carrying a key, and the value of that variable in the sandbox is a
 *   placeholder — the real one is put on the request by the egress policy, on
 *   the way out, where the agent cannot read it.
 *
 * Run from `entrypoint.sh` before the backend starts, because the backend
 * reads this file once at boot.
 *
 * Usage: node seed-settings.mjs <settings.yaml>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

/** Where the model lives, as the gateway told this sandbox. */
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? ''

/** What the model is called on the wire, and to a person. */
const MODEL_ID = process.env.MODEL_ID ?? ''
const MODEL_NAME = process.env.MODEL_NAME ?? MODEL_ID

/**
 * The provider block, as YAML.
 *
 * Written as text rather than built with a YAML library, because there is no
 * such library in the sandbox's own dependencies and the alternative — a
 * document assembled by a parser this file would have to ship — is a larger
 * thing to keep true than eight lines of indentation.
 *
 * `apiKeyEnv` and not a key: see the note at the top.
 *
 * The three compatibility switches are the ones this endpoint needs, and each
 * is here because leaving it out breaks a request rather than because it looks
 * thorough. `supportsDeveloperRole: false` keeps the system prompt on the
 * `system` role — pi-ai sends it as `developer` to anything it reads as OpenAI
 * itself, which an OpenAI-compatible gateway in front of a local model rejects
 * outright. `maxTokensField: max_tokens` is the field that endpoint reads.
 * `thinkingFormat: openai` sends the thinking level as `reasoning_effort`,
 * which is what the model's own template is driven by.
 *
 * @returns {string} the block to append.
 */
function providerBlock() {
  const efforts = (process.env.MODEL_REASONING_EFFORTS ?? 'low,medium,xhigh')
    .split(',').map((level) => level.trim()).filter((level) => level !== '')
  return [
    'llm-pi-ai:',
    '  providers:',
    '    hamster:',
    '      displayName: Hamster',
    '      apiKeyEnv: DEEPSEEK_API_KEY',
    '      api: openai-completions',
    `      baseURL: ${BASE_URL}`,
    '      compat:',
    '        thinkingFormat: openai',
    '        supportsDeveloperRole: false',
    '        maxTokensField: max_tokens',
    '      models:',
    `        - id: ${MODEL_ID}`,
    `          name: ${MODEL_NAME}`,
    ...efforts.length === 0 ? [] : [
      '          reasoningEfforts:',
      ...efforts.map((level) => `            ${level}: ${level}`),
    ],
    '',
  ].join('\n')
}

/**
 * Which model a session opens with.
 *
 * Separate from the provider because it is a different kind of statement — one
 * describes what exists, the other picks among it — and because a tenant who
 * adds a second provider should be able to keep this one's default without
 * having their route rewritten under them.
 *
 * @returns {string} the block to append.
 */
function defaultModelBlock() {
  const effort = process.env.MODEL_DEFAULT_EFFORT ?? ''
  return [
    'agent-default-model:',
    '  provider: hamster',
    `  model: ${MODEL_ID}`,
    ...effort === '' ? [] : [`  reasoningEffort: ${effort}`],
    '',
  ].join('\n')
}

const path = process.argv[2]
if (path === undefined || BASE_URL === '' || MODEL_ID === '') {
  // Not an error: a deployment that has not named a model has nothing to seed,
  // and a sandbox must start either way.
  process.exit(0)
}

let document = ''
try { document = readFileSync(path, 'utf8') } catch { document = '' }

/**
 * Whether the document already speaks about something.
 *
 * A line at column zero, which is what a top-level key is in YAML — the same
 * word indented is a field of something else and says nothing about whether
 * this section exists.
 *
 * @param {string} key - the top-level key.
 * @returns {boolean} whether it is there.
 */
const has = (key) => new RegExp(`^${key}:`, 'm').test(document)

let added = ''
if (!has('llm-pi-ai')) added += providerBlock()
if (!has('agent-default-model')) added += defaultModelBlock()
if (added === '') process.exit(0)

// Appended, and appended whole. A top-level mapping takes new keys at its end
// with no reindentation, so this cannot disturb what a tenant wrote above it —
// and a partial write is worse than no write, so the file is put back in one
// call rather than opened for appending.
const separator = document === '' || document.endsWith('\n') ? '' : '\n'
writeFileSync(path, `${document}${separator}${added}`)
console.log(`sandbox: seeded ${added.split('\n')[0].replace(':', '')}${added.includes('agent-default-model:') && added.includes('llm-pi-ai:') ? ' and agent-default-model' : ''} into settings`)
