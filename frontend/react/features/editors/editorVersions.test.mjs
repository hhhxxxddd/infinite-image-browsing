import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAudioTimeline,
  readAudioTimeline
} from '../../../src/features/media-editor/model/audioTimeline.ts'
import { emptyDocument, readDocument } from './videoStudioModel.ts'
import { readEditorSnapshot } from './editorSnapshot.ts'
import { mixPreviewSignature } from './audioMixPreview.ts'
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
test('audio and video marker notes survive saved snapshots and reject invalid notes', () => {
  for (const [kind, document, read] of [
    ['audio', createAudioTimeline(), readAudioTimeline],
    ['video', emptyDocument(), readDocument]
  ]) {
    const marker = { id: 'marker', name: '检查点', time: 1 }
    document.markers = [marker]
    assert.deepEqual(read(JSON.stringify(document)).markers, [marker])
    const signature = mixPreviewSignature(kind, document)
    const note = '备注\n' + '字'.repeat(1997)
    marker.note = note
    const current = read(JSON.stringify(document))
    const history = appendEditorVersion(readEditorVersions(null), {
      ...entry(kind, current),
      kind
    })
    current.markers[0].note = '后续修改'
    const saved = readEditorVersions(JSON.stringify(history)).entries[0]
    const snapshot = readEditorSnapshot(kind, saved.document)
    assert.equal(snapshot.document.markers[0].note, note)
    const restored = documentFromEditorVersion(saved, kind, read)
    assert.equal(restored.markers[0].note, note)
    assert.equal(mixPreviewSignature(kind, restored), signature)
    for (const invalid of [null, false, 7, [], {}, '字'.repeat(2001)]) {
      const raw = JSON.stringify({ ...document, markers: [{ ...marker, note: invalid }] })
      assert.throws(() => read(raw), /原始数据已保留/)
      assert.deepEqual(JSON.parse(raw).markers[0].note, invalid)
    }
  }
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

test('image and AI production versions coexist without allowing cross-editor restoration', () => {
  const image = { ...entry('image'), kind: 'image', document: { version: 2, layers: [] } }
  const ai = {
    ...entry('ai'),
    kind: 'ai-image',
    document: { version: 1, purpose: 'image_generation' }
  }
  let history = appendEditorVersion(readEditorVersions(null), image)
  history = appendEditorVersion(history, ai)
  const reloaded = readEditorVersions(JSON.stringify(history))
  assert.deepEqual(
    reloaded.entries.map((version) => version.kind),
    ['ai-image', 'image']
  )
  assert.throws(() => documentFromEditorVersion(image, 'ai-image', JSON.parse), /类型/)
  assert.throws(() => documentFromEditorVersion(ai, 'image', JSON.parse), /类型/)
})
