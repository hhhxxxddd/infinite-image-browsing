import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeMediaPage } from './mergeMediaPage.ts'

test('overlapping pages preserve existing card identity and ordered new files', () => {
  const existing = { fullpath: '/media/a.jpg', name: 'original' }
  const next = { fullpath: '/media/b.jpg' }
  const last = { fullpath: '/media/c.jpg' }
  const current = [existing]
  const incoming = [{ fullpath: existing.fullpath, name: 'duplicate' }, next, last]
  assert.deepEqual(mergeMediaPage(current, incoming), [existing, next, last])
  assert.deepEqual(current, [existing])
  assert.equal(incoming.length, 3)
})

test('repeated paths in one page are only appended once', () => {
  const first = { fullpath: '/media/a.jpg' }
  assert.deepEqual(mergeMediaPage([], [first, { ...first }, { ...first }]), [first])
})

test('an empty or fully overlapping page keeps the existing array', () => {
  const current = [{ fullpath: '/media/a.jpg' }]
  assert.equal(mergeMediaPage(current, []), current)
  assert.equal(mergeMediaPage(current, [{ ...current[0] }]), current)
})
