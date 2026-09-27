import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { sha256Hex } from './sha256.ts'

test('SHA-256 matches standard vectors and existing server-key hashes', () => {
  const vectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['secret_ciallo', 'b5e7724843ea08bdcc2ae023d25bba73f2ac7f6ff1f3d83103c29d23df3e4bea'],
    ['口令🔑_ciallo', '89b12421c43a156cbdcac590a5d3afb09648d38fb4718edc0a317426383592ae']
  ]
  for (const [value, expected] of vectors) assert.equal(sha256Hex(value), expected)
})

test('UTF-8, null bytes and SHA-256 block boundaries match the native reference', () => {
  const values = [
    'a\0b',
    'é',
    'e\u0301',
    '中文🙂',
    ...[55, 56, 63, 64, 65, 1000].map((n) => 'a'.repeat(n))
  ]
  for (const value of values) {
    assert.equal(sha256Hex(value), createHash('sha256').update(value, 'utf8').digest('hex'))
  }
  assert.throws(() => sha256Hex('\ud800'), URIError)
})

test('existing tag IDs retain their palette positions', () => {
  // Captured from the previous SHA-256 implementation and palette calculation.
  assert.equal(parseInt(sha256Hex('123'), 16) % 72, 48)
  assert.equal(parseInt(sha256Hex('喜欢'), 16) % 72, 0)
})

test('import and hashing work without any global WebCrypto implementation', () => {
  const moduleUrl = new URL('./sha256.ts', import.meta.url).href
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const { sha256Hex } = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(sha256Hex('abc'));
  `
    ],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
