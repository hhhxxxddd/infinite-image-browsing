import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeSavedMediaAssets } from './mediaImageSession.ts'

const snapshot = (owner, revision) => ({
  fullpath: 'snapshot:source-hash',
  edit_snapshot: { owner, revision, asset: 'source-hash' }
})

test('saving a copy preserves the original document snapshot owner and revision', () => {
  const original = snapshot('original.png', 'original-revision')
  const assets = { [original.fullpath]: original }
  const copy = { fullpath: 'copy.png', name: 'copy.png' }
  const copySnapshot = snapshot(copy.fullpath, 'copy-revision')

  mergeSavedMediaAssets(assets, copy, { [copySnapshot.fullpath]: copySnapshot }, false)

  assert.equal(assets[original.fullpath], original)
  assert.equal(assets[copy.fullpath], copy)
  assert.deepEqual(assets[original.fullpath].edit_snapshot, {
    owner: 'original.png',
    revision: 'original-revision',
    asset: 'source-hash'
  })
})

test('overwriting adopts the saved document snapshot revision and registers the output', () => {
  const original = snapshot('original.png', 'old-revision')
  const assets = { [original.fullpath]: original }
  const saved = { fullpath: 'original.png', name: 'original.png' }
  const updatedSnapshot = snapshot(saved.fullpath, 'new-revision')

  mergeSavedMediaAssets(assets, saved, { [updatedSnapshot.fullpath]: updatedSnapshot }, true)

  assert.equal(assets[original.fullpath], updatedSnapshot)
  assert.equal(assets[saved.fullpath], saved)
})
