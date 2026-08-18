/**
 * The panel's terminal plane: one WebSocket per shell.
 *
 * A WebSocket rather than the request/response the rest of the panel uses,
 * because a terminal is the one surface here where both ends speak whenever
 * they like. Output arrives from envd as a stream and has to reach the browser
 * as it comes; keystrokes arrive from the browser between the frames.
 *
 * The asymmetry underneath is worth stating, because it is why this file is
 * short. Only envd's OUTPUT is a stream — `process.Process/Start` answers with
 * one — while input and resize are ordinary unary calls addressed by the
 * shell's pid. So there is no bidirectional stream to keep alive against
 * envd, and nothing here has to reconcile two directions of backpressure.
 *
 * The socket is the session. Closing it kills the shell, and losing the shell
 * closes it: a terminal that outlives the window it was typed into is a
 * process nobody can see and nobody can stop.
 *
 * @module terminal
 */

import { resizePty, sendPtyInput, startPty } from './envd.js'
import { ROOT } from './panel-path.js'

/** The path the browser opens. */
export const TERMINAL_PATH = '/sandbox/pty'

/**
 * A terminal's shape, bounded.
 *
 * xterm sends what it measured, and what it measured comes from a window the
 * tenant controls. These are wide enough for any real terminal and narrow
 * enough that a forged number cannot ask the sandbox for a pty of a size that
 * costs it something.
 *
 * @param {unknown} value - the number that arrived.
 * @param {number} fallback - what to use when it is not one.
 * @param {number} max - the ceiling.
 * @returns {number} a usable size.
 */
function size(value, fallback, max) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback
}

/**
 * Serve one terminal over an accepted WebSocket.
 *
 * @param {import('ws').WebSocket} socket - the accepted socket.
 * @param {{email: string, id: string}} caller - who is asking.
 * @param {{ensure: Function}} sandboxes - the sandbox manager.
 * @returns {Promise<void>} resolves when the session has been set up or refused.
 */
export async function serveTerminal(socket, caller, sandboxes) {
  /**
   * Say something to the browser.
   * @param {object} message - the frame to send.
   */
  const say = (message) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
  }

  // The runtime's handle, because every call below is to envd and envd is
  // addressed by the runtime, not by the gateway's id for the sandbox.
  let handle
  try {
    ({ handle } = await sandboxes.ensure(caller.email, caller.id))
  } catch (error) {
    console.error(`gateway: no sandbox for ${caller.email}'s terminal: ${error.message}`)
    say({ type: 'error', message: '沙箱还没准备好，请稍后再试。' })
    socket.close()
    return
  }

  let pid
  let session
  // Keystrokes typed before the shell has reported its pid have nowhere to go
  // yet. Held rather than dropped: the first thing a person types is often
  // before the prompt has finished painting.
  const waiting = []

  try {
    session = await startPty(handle, {
      cols: 80,
      rows: 24,
      cwd: ROOT,
      // Nothing of the deployment's own environment: the shell inherits what
      // the sandbox's backend was started with, and this call adds only what a
      // terminal needs to render.
      envs: { TERM: 'xterm-256color' },
    }, {
      onStart: (started) => {
        pid = started
        say({ type: 'ready' })
        for (const bytes of waiting.splice(0)) {
          void sendPtyInput(handle, pid, bytes).catch(() => {})
        }
      },
      // Base64 rather than a binary frame: the socket already carries JSON in
      // both directions, and one shape is easier to reason about than two.
      onData: (bytes) => { say({ type: 'out', data: bytes.toString('base64') }) },
      onEnd: (exitCode) => {
        say({ type: 'exit', code: exitCode ?? null })
        socket.close()
      },
      onError: (error) => {
        console.error(`gateway: ${caller.email}'s terminal failed: ${error.message}`)
        say({ type: 'error', message: '终端断开了。' })
        socket.close()
      },
    })
  } catch (error) {
    console.error(`gateway: could not open a terminal for ${caller.email}: ${error.message}`)
    say({ type: 'error', message: '打不开终端。' })
    socket.close()
    return
  }

  socket.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (message.type === 'in' && typeof message.data === 'string') {
      const bytes = Buffer.from(message.data, 'base64')
      if (pid === undefined) waiting.push(bytes)
      else void sendPtyInput(handle, pid, bytes).catch(() => {})
      return
    }
    if (message.type === 'size' && pid !== undefined) {
      void resizePty(handle, pid, size(message.cols, 80, 500), size(message.rows, 24, 200)).catch(() => {})
    }
  })

  socket.on('close', () => {
    // Ending the read ends the request, which is what tells envd nobody is
    // listening any more.
    session.close()
  })
}
