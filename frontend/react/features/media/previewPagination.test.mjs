import assert from 'node:assert/strict'
import test from 'node:test'

import { nextIndexAfterPage } from './previewPagination.ts'

test('next preview item follows the same file after a sorted page insertion', () => {
  const files = [
    { fullpath: 'new-before-current' },
    { fullpath: 'current' },
    { fullpath: 'loaded-after-current' }
  ]
  assert.equal(nextIndexAfterPage(files, 'current'), 2)
})

test('no navigation occurs when a page only contains duplicates or the current file disappears', () => {
  assert.equal(nextIndexAfterPage([{ fullpath: 'current' }], 'current'), null)
  assert.equal(nextIndexAfterPage([{ fullpath: 'other' }], 'current'), null)
})
