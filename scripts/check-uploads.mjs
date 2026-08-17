/**
 * What the upload store has to hold true, decided from the tree alone.
 *
 * It is here rather than in `verify/` because none of it needs a deployment:
 * the store is a filesystem, a name, and a byte count. The acceptance suite
 * still uploads a real file through the real tunnel — that proves the plane is
 * routed and authenticated, which this cannot, while this proves the cases a
 * deployment run would never think to produce: a name that traverses, a chunk
 * that overruns, a second file of the same name on the same day.
 *
 * Run: node scripts/check-uploads.mjs
 */

import { mkdtemp, readFile, readdir, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import process from 'node:process'
import { createUploads, safeName } from '../packages/dsh-sandbox-host/uploads.js'

let failures = 0
let passes = 0

/**
 * Run one check, reporting rather than throwing.
 * @param {string} name - what is being asserted.
 * @param {() => unknown} fn - the assertion.
 */
const t = async (name, fn) => {
  try {
    await fn()
    passes += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL  ${name} -> ${error.message}`)
  }
}

const CTRL = String.fromCharCode(1)

await t('basename strips a traversal', () => assert.equal(safeName('../../etc/passwd'), 'passwd'))
await t('empty becomes file', () => assert.equal(safeName(''), 'file'))
await t('dot becomes file', () => assert.equal(safeName('.'), 'file'))
await t('dotdot becomes file', () => assert.equal(safeName('..'), 'file'))
await t('no separator survives', () => assert.equal(safeName('a' + String.fromCharCode(92) + 'b.txt').includes('/'), false))
await t('control characters go', () => assert.equal(safeName('a' + CTRL + 'b.txt'), 'a_b.txt'))
await t('spaces survive', () => assert.equal(safeName('my notes.txt'), 'my notes.txt'))
await t('long names are cut', () => assert.ok(safeName('x'.repeat(400)).length <= 180))

// A root that is a symlink, which is what /workspace is whenever a tenant has a volume.
// realpath'd because macOS resolves /var to /private/var, and the store
// publishes resolved paths.
const real = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-real-')))
const link = path.join(await mkdtemp(path.join(tmpdir(), 'dsh-link-')), 'workspace')
await symlink(real, link)
const uploads = createUploads(link)

const body = Buffer.from('hello sandbox')

await t('a small upload commits where it says', async () => {
  const { id } = await uploads.begin('probe.txt', body.length)
  await uploads.chunk(id, body.toString('base64'))
  const done = await uploads.commit(id)
  assert.ok(done.path.startsWith(real + path.sep), 'published under the resolved root: ' + done.path)
  assert.equal(done.name, 'probe.txt')
  assert.equal(done.bytes, body.length)
  assert.equal(await readFile(done.path, 'utf8'), 'hello sandbox')
})

await t('a same-day duplicate becomes a second file', async () => {
  const { id } = await uploads.begin('probe.txt', body.length)
  await uploads.chunk(id, body.toString('base64'))
  const done = await uploads.commit(id)
  assert.equal(path.basename(done.path), 'probe-1.txt')
})

await t('nothing is left staged', async () => {
  assert.deepEqual(await readdir(path.join(real, 'uploads', '.staging')), [])
})

await t('a multi-chunk upload reassembles in order', async () => {
  const big = Buffer.concat([Buffer.alloc(10, 0x41), Buffer.alloc(10, 0x42)])
  const { id } = await uploads.begin('two.bin', big.length)
  await uploads.chunk(id, big.subarray(0, 10).toString('base64'))
  await uploads.chunk(id, big.subarray(10).toString('base64'))
  const done = await uploads.commit(id)
  assert.equal((await readFile(done.path)).toString(), 'A'.repeat(10) + 'B'.repeat(10))
})

await t('a zero-byte file is legal', async () => {
  const { id } = await uploads.begin('empty.txt', 0)
  const done = await uploads.commit(id)
  assert.equal((await readFile(done.path)).length, 0)
})

await t('overrunning the declared size is refused and discards', async () => {
  const { id } = await uploads.begin('over.txt', 3)
  await assert.rejects(() => uploads.chunk(id, Buffer.from('too long').toString('base64')), RangeError)
  await assert.rejects(() => uploads.commit(id), /no such upload/)
})

await t('committing short is refused', async () => {
  const { id } = await uploads.begin('short.txt', 10)
  await uploads.chunk(id, Buffer.from('ab').toString('base64'))
  await assert.rejects(() => uploads.commit(id), /declared 10/)
})

await t('an unknown id is refused', async () => {
  await assert.rejects(() => uploads.commit('nope'), /no such upload/)
  await assert.rejects(() => uploads.chunk('nope', ''), /no such upload/)
})

await t('a negative or absurd size is refused', async () => {
  await assert.rejects(() => uploads.begin('x', -1), RangeError)
  await assert.rejects(() => uploads.begin('x', 2 ** 40), RangeError)
  await assert.rejects(() => uploads.begin('x', 'abc'), RangeError)
})

await t('the in-flight limit holds and abort frees a slot', async () => {
  const ids = []
  for (let i = 0; i < 16; i += 1) ids.push((await uploads.begin('f' + i, 1)).id)
  await assert.rejects(() => uploads.begin('one-too-many', 1), /too many uploads/)
  await uploads.abort(ids[0])
  const { id } = await uploads.begin('now-there-is-room', 1)
  assert.ok(id)
  for (const each of [...ids.slice(1), id]) await uploads.abort(each)
})

await t('a traversing name cannot leave the dated directory', async () => {
  const { id } = await uploads.begin('../../escape.txt', 2)
  await uploads.chunk(id, Buffer.from('hi').toString('base64'))
  const done = await uploads.commit(id)
  assert.ok(done.path.startsWith(path.join(real, 'uploads') + path.sep), done.path)
  assert.equal(path.basename(done.path), 'escape.txt')
})

await uploads.close()
console.log(failures === 0 ? `\ncheck-uploads: ${String(passes)} check(s) passed` : `\ncheck-uploads: ${String(failures)} failed`)
process.exit(failures === 0 ? 0 : 1)
