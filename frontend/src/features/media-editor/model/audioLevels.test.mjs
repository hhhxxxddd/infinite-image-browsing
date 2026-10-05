import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeLevels, levelDb, levelLabel } from './audioLevels.ts'
test('mixed floating-point peaks retain overload and silence independently in both channels', () => {
  const data = Buffer.alloc(16)
  ;[0, 0.5, 1.5, 2].forEach((value, index) => data.writeFloatLE(value, index * 4))
  assert.deepEqual(decodeLevels(data.toString('base64')), [
    [0, 0.5],
    [1.5, 2]
  ])
  assert.equal(levelDb(0), -Infinity)
  assert.ok(Math.abs(levelDb(2) - 6.0206) < 0.001)
  assert.equal(levelLabel(-Infinity), '−∞ dBFS')
  assert.equal(levelLabel(-285.9), '−∞ dBFS')
  assert.equal(levelLabel(-60.01), '−∞ dBFS')
  assert.equal(levelLabel(-60), '-60.0 dBFS')
  assert.equal(levelLabel(0.1), '0.1 dBFS')
  data.writeFloatLE(NaN, 0)
  assert.deepEqual(decodeLevels(data.toString('base64')), [])
  assert.deepEqual(decodeLevels('bad'), [])
})
