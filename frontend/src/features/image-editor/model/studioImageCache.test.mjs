import assert from 'node:assert/strict'
import test from 'node:test'
import { createStudioImageCache } from './studioImageCache.ts'

test('twenty distinct image layers stay cached across frames', async () => {
  let loads = 0
  const cache = createStudioImageCache(async () => {
    loads++
    return { naturalWidth: 1280, naturalHeight: 1280 }
  })
  const urls = Array.from({ length: 20 }, (_, index) => `${index}.png`)
  for (let frame = 0; frame < 3; frame++) {
    cache.retain(new Set(urls))
    for (const url of urls) await cache.load(url, 1280 * 1280)
  }
  assert.equal(loads, 20)
})

test('an oversized document keeps a stable subset instead of evicting every image', async () => {
  const counts = new Map()
  const cache = createStudioImageCache(async (url) => {
    counts.set(url, (counts.get(url) ?? 0) + 1)
    return { naturalWidth: 10, naturalHeight: 10 }
  }, 200)
  for (let frame = 0; frame < 3; frame++)
    for (const url of ['a', 'b', 'c']) await cache.load(url, 100)
  assert.deepEqual([...counts.values()], [1, 1, 3])
  cache.retain(new Set(['c']))
  await cache.load('c', 100)
  await cache.load('c', 100)
  assert.equal(counts.get('c'), 4)
})

test('failed images can be retried and concurrent loads share their task', async () => {
  let finish
  let loads = 0
  const cache = createStudioImageCache(() => {
    loads++
    return new Promise((resolve) => (finish = resolve))
  })
  const first = cache.load('image', 100)
  assert.equal(cache.load('image', 100), first)
  finish(null)
  await first
  const retry = cache.load('image', 100)
  finish({ naturalWidth: 10, naturalHeight: 10 })
  await retry
  assert.equal(loads, 2)
})

test('completion of a cleared request cannot remove its replacement', async () => {
  const completions = []
  const cache = createStudioImageCache(() => new Promise((resolve) => completions.push(resolve)))
  const old = cache.load('image', 100)
  cache.clear()
  const current = cache.load('image', 100)
  completions[0](null)
  await old
  assert.equal(cache.load('image', 100), current)
  completions[1]({ naturalWidth: 10, naturalHeight: 10 })
  await current
})

test('a small encoded image with unexpectedly huge dimensions is not retained', async () => {
  let loads = 0
  const cache = createStudioImageCache(async () => {
    loads++
    return { naturalWidth: 100, naturalHeight: 100 }
  }, 200)
  await cache.load('large', 100)
  await cache.load('large', 100)
  assert.equal(loads, 2)
})
