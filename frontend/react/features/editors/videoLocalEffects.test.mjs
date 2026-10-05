import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultLocalVideoEffects,
  validateLocalVideoEffects,
  localRegionCoverage,
  localColorChannel,
  processLocalVideoPixels,
  regionFromDrag,
  moveLocalRegion
} from './videoLocalEffects.ts'

const region = (patch = {}) => ({
  id: 'one',
  shape: 'rectangle',
  effect: 'mask',
  x: 0.25,
  y: 0.25,
  width: 0.5,
  height: 0.5,
  invert: false,
  feather: 0,
  strength: 0.5,
  ...patch
})
const effects = (patch = {}) => ({ ...defaultLocalVideoEffects(), ...patch })
test('invalid persisted regions, overflow and nonfinite color are rejected', () => {
  assert.ok(validateLocalVideoEffects(effects()))
  for (const item of [
    effects({ gamma: 0 }),
    effects({ exposure: Infinity }),
    effects({ regions: [region({ x: 0.8 })] }),
    effects({ regions: Array.from({ length: 9 }, (_, i) => region({ id: String(i) })) }),
    effects({ regions: [region(), region()] })
  ])
    assert.equal(validateLocalVideoEffects(item), false)
})
test('region drawing in either direction and at frame edges stays valid; moving clamps extent', () => {
  for (const [a, b] of [
    [
      { x: 0.8, y: 0.7 },
      { x: 0.1, y: 0.2 }
    ],
    [
      { x: 1, y: 1 },
      { x: 1, y: 1 }
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ]
  ])
    assert.ok(validateLocalVideoEffects(effects({ regions: [region(regionFromDrag(a, b))] })))
  assert.equal(moveLocalRegion(region(), 10, -10).x, 0.5)
  assert.equal(moveLocalRegion(region(), 10, -10).y, 0)
})
test('rectangular and elliptical soft inverse masks complement each other', () => {
  for (const shape of ['rectangle', 'ellipse'])
    for (const feather of [0, 0.2])
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 32; x++) {
          const item = region({ shape, feather })
          assert.ok(
            Math.abs(
              localRegionCoverage(item, x, y, 32, 24) +
                localRegionCoverage({ ...item, invert: true }, x, y, 32, 24) -
                1
            ) < 1e-12
          )
        }
})
test('color order exposure/balance/gamma matches exported reference values and preserves alpha', () => {
  const item = effects({ exposure: 0.7, temperature: 0.6, tint: -0.4, gamma: 1.4 })
  const data = new Uint8ClampedArray([100, 80, 60, 200])
  processLocalVideoPixels(data, 1, 1, item)
  assert.deepEqual(
    [...data],
    [...[100, 80, 60].map((v, i) => Math.floor(localColorChannel(v, i, item))), 200]
  )
  assert.deepEqual([...data], [210, 146, 118, 200])
})
test('mask then local blur/mosaic keeps erased alpha and original outside pixels', () => {
  const data = new Uint8ClampedArray(
    Array.from({ length: 32 * 24 }, () => [100, 80, 60, 200]).flat()
  )
  processLocalVideoPixels(
    data,
    32,
    24,
    effects({
      regions: [
        region(),
        region({ id: 'two', effect: 'blur' }),
        region({ id: 'three', effect: 'mosaic' })
      ]
    })
  )
  assert.deepEqual([...data.slice((12 * 32 + 16) * 4, (12 * 32 + 16) * 4 + 4)], [100, 80, 60, 0])
  assert.deepEqual([...data.slice(0, 4)], [100, 80, 60, 200])
})
test('box blur has actual neighborhood averaging and feathered blend; zero strength is unchanged', () => {
  const data = new Uint8ClampedArray(32 * 24 * 4)
  for (let i = 0; i < data.length; i += 4) data[i + 3] = 177
  data[(12 * 32 + 16) * 4] = 255
  const unchanged = data.slice()
  processLocalVideoPixels(
    unchanged,
    32,
    24,
    effects({ regions: [region({ effect: 'blur', strength: 0 })] })
  )
  assert.equal(unchanged[(12 * 32 + 16) * 4], 255)
  processLocalVideoPixels(
    data,
    32,
    24,
    effects({ regions: [region({ effect: 'blur', strength: 1 })] })
  )
  assert.equal(data[(12 * 32 + 16) * 4], 28)
  assert.equal(data[(12 * 32 + 15) * 4], 28)
  assert.equal(data[3], 177)
})
test('mosaic uses a stable canvas grid and leaves outside unchanged', () => {
  const data = new Uint8ClampedArray(
    Array.from({ length: 32 * 24 }, (_, i) => [(i % 32) * 7, Math.floor(i / 32) * 9, 0, 180]).flat()
  )
  const original = data.slice()
  processLocalVideoPixels(
    data,
    32,
    24,
    effects({ regions: [region({ effect: 'mosaic', strength: 1 })] })
  )
  assert.deepEqual(
    [...data.slice((12 * 32 + 16) * 4, (12 * 32 + 16) * 4 + 4)],
    [17 * 7, 13 * 9, 0, 180]
  )
  assert.deepEqual(data.slice(0, 32 * 4 * 6), original.slice(0, 32 * 4 * 6))
})
test('preview refuses full-resolution oversized or malformed frames before allocating scratch', () => {
  assert.throws(
    () => processLocalVideoPixels(new Uint8ClampedArray(4), 3840, 2160, effects({ exposure: 1 })),
    /尺寸/
  )
  assert.throws(
    () => processLocalVideoPixels(new Uint8ClampedArray(3), 1, 1, effects({ exposure: 1 })),
    /尺寸/
  )
})
