import test from 'node:test'
import assert from 'node:assert/strict'
import { duplicateStudioSelection } from '../../../src/features/image-editor/model/imageStudioSelection.ts'
import {
  createImageLayer,
  createStudioDocument,
  readStudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel.ts'
import {
  applyCutoutResult,
  cutoutRevision,
  imageToolLayerName,
  recoverImageToolResult
} from '../../../src/features/image-editor/model/imageStudioCutout.ts'
import { sha256Hex } from '../../../src/shared/lib/sha256.ts'
import { submitImageToolRequest } from './imageToolSubmission.ts'
import {
  mergeSavedMediaAssets,
  remapRenamedMediaAssets,
  remapRenamedMediaDocument
} from './mediaImageSession.ts'

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

test('renaming keeps snapshot revisions and relinks source layers in current, undo and copied documents', () => {
  const source = 'C:\\images\\old.png'
  const file = { fullpath: 'C:\\images\\new.png', name: 'new.png' }
  const owned = snapshot(source, 'saved-revision')
  const external = { ...snapshot('other.png', 'other-revision'), fullpath: 'snapshot:other' }
  const assets = {
    [source]: { fullpath: source },
    [owned.fullpath]: owned,
    [external.fullpath]: external
  }
  const original = {
    name: 'old',
    groups: [],
    layers: [
      { id: 'source-layer', kind: 'image', path: source, name: 'old.png', x: 0 },
      { kind: 'image', path: source, name: '自定义图层', x: 100 },
      { kind: 'image', path: external.fullpath, name: '外部图片' },
      { kind: 'text', text: 'old.png' }
    ]
  }
  const edited = { ...original, layers: original.layers.map((layer) => ({ ...layer, x: 200 })) }
  const copied = structuredClone(edited)

  remapRenamedMediaAssets(assets, source, file)
  const before = remapRenamedMediaDocument(original, source, file)
  const after = remapRenamedMediaDocument(edited, source, file)
  const pasted = duplicateStudioSelection(remapRenamedMediaDocument(copied, source, file), [
    'source-layer'
  ])

  assert.equal(assets[source], undefined)
  assert.equal(assets[file.fullpath], file)
  assert.deepEqual(assets[owned.fullpath].edit_snapshot, {
    ...owned.edit_snapshot,
    owner: file.fullpath
  })
  assert.equal(assets[external.fullpath], external)
  assert.equal(before.name, 'new')
  assert.equal(before.layers[0].path, file.fullpath)
  assert.equal(before.layers[0].name, file.name)
  assert.equal(before.layers[0].x, 0)
  assert.equal(after.layers[0].x, 200)
  assert.equal(after.layers[1].name, '自定义图层')
  assert.equal(after.layers[2].path, external.fullpath)
  assert.equal(after.layers[3].text, 'old.png')
  assert.equal(
    pasted.document.layers.find((layer) => layer.id === pasted.layerIds[0]).path,
    file.fullpath
  )
  assert.equal(copied.layers[0].path, source)
  assert.equal(original.layers[0].path, source)
})

test('renaming twice retains AI input recovery and an unconfirmed submission receipt', async () => {
  const source = 'C:\\images\\original.png'
  const document = createStudioDocument()
  const layer = createImageLayer(source, { x: 0, y: 0, width: 200, height: 100 }, 'original.png')
  document.layers = [layer]
  const job = {
    id: 'completed',
    layer_id: layer.id,
    source_revision: cutoutRevision(layer),
    state: 'completed',
    result: { path: 'editor-asset:result' }
  }
  const first = remapRenamedMediaDocument(document, source, {
    fullpath: 'C:\\images\\renamed.png',
    name: 'renamed.png'
  })
  const renamed = readStudioDocument(
    remapRenamedMediaDocument(first, first.layers[0].path, {
      fullpath: 'C:\\images\\final.png',
      name: 'final.png'
    })
  )
  assert.equal(cutoutRevision(renamed.layers[0]), job.source_revision)
  const recovered = recoverImageToolResult(renamed, job)
  assert.equal(recovered.layers[0].path, job.result.path)
  assert.equal(recovered.layers[0].taskSource, undefined)
  assert.equal(
    applyCutoutResult({ ...renamed, layers: [{ ...renamed.layers[0], path: 'other.png' }] }, job),
    undefined
  )

  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
  const scope = sha256Hex(`media:${source}`)
  const fingerprint = (layer) =>
    sha256Hex(
      JSON.stringify({
        document_key: scope,
        layer_id: layer.id,
        layer_name: imageToolLayerName(layer),
        source_revision: cutoutRevision(layer)
      })
    )
  let sentId
  await assert.rejects(
    submitImageToolRequest(storage, fingerprint(layer), async (id) => {
      sentId = id
      throw new Error('response lost')
    })
  )
  await submitImageToolRequest(storage, fingerprint(renamed.layers[0]), async (id) =>
    assert.equal(id, sentId)
  )
  assert.equal(values.size, 0)
})
