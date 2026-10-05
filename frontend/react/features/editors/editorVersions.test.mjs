import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendEditorVersion,
  documentFromEditorVersion,
  editorVersionLimit,
  editorVersionsKey,
  readEditorVersions
} from './editorVersionModel.ts'

const entry = (
  id,
  document = { version: 1, visuals: [{ path: 'movie.mp4', sourceIn: 7200, duration: 5 }] }
) => ({
  id,
  name: `版本 ${id}`,
  createdAt: '2026-10-05T00:00:00.000Z',
  kind: 'video',
  document
})
test('snapshots survive serialization and do not alias mutable current edit instructions', () => {
  const current = entry('one')
  const saved = appendEditorVersion(readEditorVersions(null), current)
  current.document.visuals[0].duration = 10
  const reloaded = readEditorVersions(JSON.stringify(saved))
  assert.equal(reloaded.entries[0].document.visuals[0].sourceIn, 7200)
  assert.equal(reloaded.entries[0].document.visuals[0].duration, 5)
  const restored = documentFromEditorVersion(reloaded.entries[0], 'video', JSON.parse)
  restored.visuals[0].duration = 99
  assert.equal(reloaded.entries[0].document.visuals[0].duration, 5)
})
test('retention keeps the most recent versions and counts UTF-8 bytes', () => {
  let saved = readEditorVersions(null)
  for (let i = 0; i < 40; i++) saved = appendEditorVersion(saved, entry(String(i)))
  assert.equal(saved.entries.length, editorVersionLimit)
  assert.equal(saved.entries[0].id, '39')
  assert.equal(saved.entries.at(-1).id, '10')
  const large = entry('new', { text: '字'.repeat(40) })
  const budget = new TextEncoder().encode(JSON.stringify({ version: 1, entries: [large] })).length
  const bounded = appendEditorVersion(saved, large, budget)
  assert.equal(bounded.entries.length, 1)
  assert.throws(() => appendEditorVersion(saved, large, budget - 1), /过大/)
  assert.equal(saved.entries.length, editorVersionLimit)
})
test('corrupt or duplicate version records are rejected instead of resetting the history', () => {
  for (const raw of [
    '{',
    'null',
    '{"version":2,"entries":[]}',
    JSON.stringify({ version: 1, entries: [entry('one'), entry('one')] })
  ])
    assert.throws(() => readEditorVersions(raw), /原始记录已保留/)
  assert.throws(
    () =>
      readEditorVersions(
        JSON.stringify({ version: 1, entries: [{ ...entry('x'), document: null }] })
      ),
    /无法读取/
  )
})
test('restoration validates document format and editor kind before any overwrite', () => {
  assert.throws(() => documentFromEditorVersion(entry('x'), 'audio', JSON.parse), /类型/)
  assert.throws(
    () =>
      documentFromEditorVersion(entry('x'), 'video', () => {
        throw new Error('bad document')
      }),
    /bad document/
  )
  assert.notEqual(editorVersionsKey('a', 'doc'), editorVersionsKey('ab', 'doc'))
  assert.notEqual(editorVersionsKey('a', 'doc'), editorVersionsKey('a', 'doc2'))
})
