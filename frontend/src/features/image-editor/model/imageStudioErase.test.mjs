import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyEraseDraft,
  erasePlan,
  eraseBlendBounds,
  eraseProcessingBox
} from './imageStudioErase.ts'
import {
  isCutoutJob,
  isEraseJob,
  imageToolName,
  currentCutoutJobs,
  applyCutoutResult,
  cutoutRevision,
  cutoutBeforeDocument
} from './imageStudioCutout.ts'
import { createImageLayer, createStudioDocument } from './imageStudioModel.ts'

test('erase defaults to 16 and keeps user brush holes independent of context', () => {
  assert.equal(emptyEraseDraft().blend_pixels, 16)
  const draft = {
    ...emptyEraseDraft(),
    bounds: { x: 100, y: 100, width: 50, height: 40 },
    context: { x: 90, y: 90, width: 80, height: 70 },
    range: 'manual',
    linked: false
  }
  const plan = erasePlan(draft, { width: 400, height: 300 })
  assert.deepEqual(eraseBlendBounds(draft.bounds, { width: 400, height: 300 }, 16), {
    x: 89,
    y: 89,
    width: 72,
    height: 62
  })
  assert.deepEqual(plan.processing, { x: 89, y: 84, width: 81, height: 81 })
  assert.deepEqual(plan.target, { width: 512, height: 512 })
})
test('whole image retains rectangular context and rounds linked model dimensions', () => {
  const plan = erasePlan({ ...emptyEraseDraft(), range: 'whole' }, { width: 1600, height: 900 })
  assert.deepEqual(plan.context, { x: 0, y: 0, width: 1600, height: 900 })
  assert.deepEqual(plan.target, { width: 512, height: 288 })
  assert.deepEqual(plan.processing, plan.context)
  assert.deepEqual(
    eraseProcessingBox(
      { x: 0, y: 0, width: 400, height: 200 },
      { width: 512, height: 512 },
      { width: 400, height: 200 }
    ),
    { x: 0, y: -100, width: 400, height: 400 }
  )
})
test('manual region cannot exclude mask or blur; zero blend and edge shifting work', () => {
  const draft = {
    ...emptyEraseDraft(),
    bounds: { x: 0, y: 0, width: 20, height: 20 },
    context: { x: 10, y: 10, width: 2, height: 2 },
    range: 'manual',
    linked: false,
    blend_pixels: 0,
    output_width: 1024
  }
  const plan = erasePlan(draft, { width: 100, height: 100 })
  assert.deepEqual(plan.processing, { x: 0, y: 0, width: 40, height: 20 })
  assert.equal(plan.target.width, 1024)
})
test('erase is a distinct buffer and application/comparison keeps layer geometry after a move', () => {
  const doc = createStudioDocument()
  const layer = createImageLayer('/source.png', { x: 10, y: 20, width: 300, height: 200 })
  Object.assign(layer, { rotation: 30, opacity: 0.6 })
  doc.layers = [layer]
  const job = {
    id: 'erase',
    tool_id: 'image-erase',
    layer_id: layer.id,
    state: 'completed',
    source_revision: cutoutRevision(layer),
    created_at: 3,
    source: { path: 'editor-asset:before', width: 300, height: 200 },
    result: { path: 'editor-asset:after', width: 300, height: 200 }
  }
  assert.equal(isCutoutJob(job), false)
  assert.equal(isEraseJob(job), true)
  assert.equal(imageToolName(job), '消除')
  layer.x = 60
  const after = applyCutoutResult(doc, job)
  for (const key of ['id', 'x', 'y', 'width', 'height', 'rotation', 'opacity'])
    assert.equal(after.layers[0][key], layer[key])
  assert.equal(cutoutBeforeDocument(after, job).layers[0].path, job.source.path)
  assert.equal(after.layers[0].path, job.result.path)
  const history = [
    job,
    { ...job, id: 'old', created_at: 1 },
    { ...job, id: 'cutout', tool_id: 'image-cutout-sam3', created_at: 2 }
  ]
  assert.deepEqual(
    currentCutoutJobs(history).map((v) => v.id),
    ['erase', 'cutout']
  )
})
