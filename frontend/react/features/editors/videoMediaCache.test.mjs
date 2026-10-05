import assert from 'node:assert/strict'
import test from 'node:test'
import { VideoMediaCache } from './videoMediaCache.ts'

const info = (fingerprint, proxy_url = null) => ({ fingerprint, proxy_url })
const job = (fingerprint, state = 'succeeded') => ({
  id: `job-${fingerprint}`,
  path: 'source',
  fingerprint,
  state,
  progress: 1,
  proxy_url: '/proxy'
})

test('replacement source and missing disk cache invalidate succeeded jobs and allow retry', () => {
  const cache = new VideoMediaCache()
  cache.acceptInfo('source', 0, info('a'))
  cache.acceptJob('source', 0, job('a'))
  assert.equal(cache.proxyVersion('source'), 'a')
  cache.acceptInfo('source', cache.epoch('source'), info('b'))
  assert.equal(cache.proxyVersion('source'), undefined)
  assert.equal(cache.jobs.size, 0)
  assert.equal(cache.canPrepare('source', 'b', false), true)
  cache.acceptJob('source', cache.epoch('source'), job('b'))
  cache.acceptInfo('source', cache.epoch('source'), info('b'))
  assert.equal(cache.proxyVersion('source'), undefined)
  assert.equal(cache.canPrepare('source', 'b', false), true)
})

test('late metadata, submission and polling cannot revive a cleared or failed proxy', () => {
  const cache = new VideoMediaCache()
  cache.acceptInfo('source', 0, info('a', '/proxy'))
  cache.acceptJob('source', 0, job('a', 'running'))
  const pending = cache.epoch('source')
  cache.invalidate('source')
  assert.equal(cache.acceptInfo('source', pending, info('a', '/proxy')), false)
  assert.equal(cache.acceptJob('source', pending, job('a')), false)
  assert.equal(cache.proxyVersion('source'), undefined)
  assert.equal(cache.canPrepare('source', 'a', false), false)
  assert.equal(cache.canPrepare('source', 'a', true), true)
  assert.equal(cache.cached('source'), undefined)
})

test('metadata begun before completion cannot hide the newly finished proxy', () => {
  const cache = new VideoMediaCache()
  cache.acceptInfo('source', 0, info('a'))
  cache.acceptJob('source', 0, job('a', 'running'))
  const pending = cache.epoch('source')
  cache.acceptJob('source', pending, job('a'), 'job-a')
  assert.equal(cache.acceptInfo('source', pending, info('a')), false)
  assert.equal(cache.proxyVersion('source'), 'a')
  assert.equal(cache.acceptJob('source', cache.epoch('source'), job('old'), 'job-old'), false)
})

test('ordinary metadata is reusable briefly; explicit invalidation bypasses its lifetime', () => {
  const cache = new VideoMediaCache()
  const value = info('a')
  cache.acceptInfo('source', 0, value)
  assert.equal(cache.cached('source'), value)
  assert.equal(cache.cached('source', Date.now() + 30001), undefined)
  cache.invalidate('source')
  assert.equal(cache.cached('source'), undefined)
})
