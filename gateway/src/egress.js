/**
 * What a sandbox may reach, and what gets added to its requests on the way out.
 *
 * Two things are decided here, both at sandbox creation and both enforced by
 * CubeSandbox rather than by anything inside the sandbox:
 *
 * - The gateway is reachable. CubeSandbox allows public egress by default but
 *   denies the private ranges alongside it, so that a sandbox cannot use its
 *   internet access to reach the infrastructure running it. The gateway sits on
 *   one of those ranges, so its address is allowed back in explicitly.
 *
 * - The model credential never enters the sandbox. The sandbox is handed a
 *   placeholder and CubeEgress replaces the `Authorization` header with the real
 *   key as the request passes through it. This matters because the agent inside
 *   runs with full access on the tenant's behalf: anything in its environment,
 *   its filesystem, or its process table is something a prompt can be made to
 *   read back. A key that is never there cannot be read back.
 *
 * The rule is scoped to the model host, which is also what keeps the
 * interception scoped: CubeVS routes traffic through CubeEgress only for hosts
 * a rule names, so everything else the agent reaches goes out directly and
 * unintercepted.
 */

import process from 'node:process'

/**
 * What stands in for the model credential inside the sandbox.
 *
 * Not empty: the harness needs a credential configured to build a request at
 * all, and CubeEgress replaces the header rather than appending to it, so
 * whatever is here is overwritten before the request leaves the host. It reads
 * as what it is if it ever shows up in a log.
 */
export const MODEL_KEY_PLACEHOLDER = 'injected-by-egress-policy'

/**
 * The IPv4 literal a sandbox must be allowed to reach, taken from the URL its
 * tunnel dials.
 *
 * An address, not a name: a DNS name in `allowOut` is only honoured alongside a
 * `0.0.0.0/0` deny-all, which would take everything else down with it.
 *
 * @param {string} tunnelUrl - the URL sandboxes dial the gateway on.
 * @returns {string} the address to allow.
 * @throws {Error} when the URL does not name the gateway by IPv4 address.
 */
function gatewayAddress(tunnelUrl) {
  const { hostname } = new URL(tunnelUrl)
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    throw new Error(
      `egress: GATEWAY_TUNNEL_URL must name the gateway by IPv4 address, got ${JSON.stringify(hostname)} — ` +
      'a hostname can only be allowed out of a sandbox together with a deny-all rule that would also block the model API',
    )
  }
  return hostname
}

/**
 * The rule that injects the model credential, or nothing when there is no
 * credential to protect or no host to scope it to.
 *
 * @param {string} baseUrl - the model endpoint the harness calls.
 * @param {string} apiKey - the real credential, which stays on this side.
 * @returns {object[]} zero or one CubeEgress rule.
 */
function injectionRules(baseUrl, apiKey) {
  if (apiKey === '' || baseUrl === '') return []
  const { protocol, hostname } = new URL(baseUrl)
  // CubeEgress mints a leaf certificate for the requested SNI, so it can only
  // rewrite what it can decrypt. A plaintext endpoint would work too, but then
  // the credential it injects would cross the network in the clear.
  if (protocol !== 'https:') {
    throw new Error(`egress: DEEPSEEK_BASE_URL must be https to inject a credential, got ${JSON.stringify(baseUrl)}`)
  }
  return [{
    name: 'model-api-credential',
    match: { scheme: 'https', sni: hostname, host: hostname },
    action: {
      allow: true,
      audit: 'metadata',
      inject: [{ header: 'Authorization', format: 'Bearer ${SECRET}', secret: apiKey }],
    },
  }]
}

/**
 * Split one sandbox's configuration into what goes inside it and what is
 * enforced around it.
 *
 * @param {Record<string, string>} env - the environment the sandbox was going to be started with.
 * @returns {{env: Record<string, string>, network: {allowOut: string[], rules: object[]}}} the environment with the credential withheld, and the policy that supplies it instead.
 */
export function protectedEgress(env) {
  const rules = injectionRules(env.DEEPSEEK_BASE_URL ?? '', env.DEEPSEEK_API_KEY ?? '')
  return {
    env: rules.length === 0 ? env : { ...env, DEEPSEEK_API_KEY: MODEL_KEY_PLACEHOLDER },
    network: { allowOut: [gatewayAddress(env.GATEWAY_TUNNEL_URL)], rules },
  }
}

/**
 * Whether this deployment expects CubeEgress to supply the model credential.
 *
 * Read by the acceptance run, which has to know whether finding the real key
 * inside a sandbox is the arrangement or a failure of it.
 *
 * @returns {boolean} whether a credential is being withheld from sandboxes.
 */
export function injectsModelCredential() {
  return process.env.SANDBOX_RUNTIME === 'cube'
    && (process.env.DEEPSEEK_API_KEY ?? '') !== ''
    && (process.env.DEEPSEEK_BASE_URL ?? '') !== ''
}
