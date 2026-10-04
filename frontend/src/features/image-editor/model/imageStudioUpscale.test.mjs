import test from 'node:test'
import assert from 'node:assert/strict'
import { createImageLayer, createStudioDocument } from './imageStudioModel.ts'
import { imageToolInputSize, upscaleOutputSize, upscaleSizeError } from './imageStudioUpscale.ts'
import {
  applyCutoutResult,
  currentCutoutJobs,
  cutoutBeforeDocument,
  cutoutRevision,
  previousCutout
} from './imageStudioCutout.ts'

test('upscale predicts native pixels, 1× odd alignment and large result rejection without downsampling', () => {
  const layer = createImageLayer('/source.png', { x: 10, y: 20, width: 300, height: 200 })
  assert.deepEqual(imageToolInputSize(layer, { width: 6000, height: 4000 }), {
    width: 6000,
    height: 4000
  })
  assert.equal(upscaleSizeError({ width: 6000, height: 4000 }, 2), '')
  assert.ok(upscaleSizeError({ width: 6000, height: 4000 }, 4))
  assert.deepEqual(upscaleOutputSize({ width: 301, height: 199 }, 1), { width: 300, height: 198 })
  assert.deepEqual(upscaleOutputSize({ width: 301, height: 199 }, 4), { width: 1204, height: 796 })
  assert.ok(upscaleSizeError({ width: 1, height: 20 }, 1))
  layer.crop = { x: 0, y: 0, width: 0.5, height: 0.5 }
  assert.deepEqual(imageToolInputSize(layer, { width: 6000, height: 4000 }), {
    width: 3000,
    height: 2000
  })
})

test('upscale keeps canvas geometry and compares original input; retry does not multiply prior result', () => {
  const doc = createStudioDocument()
  const layer = createImageLayer('/source.png', { x: 10, y: 20, width: 300, height: 200 })
  Object.assign(layer, { rotation: 17, opacity: 0.7, brightness: 110 })
  doc.layers = [layer]
  const job = {
    id: 'upscale',
    tool_id: 'image-upscale',
    multiplier: 4,
    layer_id: layer.id,
    state: 'completed',
    source_revision: cutoutRevision(layer),
    created_at: 1,
    source: { path: 'editor-asset:input', width: 600, height: 400 },
    result: { path: 'editor-asset:result', width: 2400, height: 1600 }
  }
  layer.x = 50
  const after = applyCutoutResult(doc, job)
  for (const key of ['id', 'x', 'y', 'width', 'height', 'rotation', 'opacity'])
    assert.equal(after.layers[0][key], layer[key])
  assert.equal(after.layers[0].path, job.result.path)
  const previous = previousCutout(after.layers[0], [job])
  assert.equal(previous.source.width, 600)
  assert.deepEqual(upscaleOutputSize(previous.source, 2), { width: 1200, height: 800 })
  const before = cutoutBeforeDocument(after, previous)
  assert.equal(before.layers[0].path, job.source.path)
  assert.equal(after.layers[0].path, job.result.path)
  assert.equal(previousCutout(layer, [job]), undefined) // undo invalidates comparison
})

test('one successful pair per tool and layer; failures keep prior success in both tools', () => {
  const job = { layer_id: 'image', state: 'completed', result: { path: 'result' } }
  const jobs = [
    { ...job, id: 'cutout-old', created_at: 1 },
    { ...job, id: 'cutout-new', created_at: 3 },
    { ...job, id: 'upscale-old', tool_id: 'image-upscale', created_at: 2 },
    { ...job, id: 'upscale-new', tool_id: 'image-upscale', created_at: 4 },
    {
      ...job,
      id: 'upscale-failed',
      tool_id: 'image-upscale',
      created_at: 5,
      state: 'failed',
      result: undefined
    }
  ]
  assert.deepEqual(
    currentCutoutJobs(jobs).map((item) => item.id),
    ['upscale-failed', 'upscale-new', 'cutout-new']
  )
})

test('short-edge presets preserve ratio, predict even pixels and enforce output limits', () => {
  assert.deepEqual(upscaleOutputSize({ width: 4000, height: 3000 }, '2K'), {
    width: 2730,
    height: 2048
  })
  assert.deepEqual(upscaleOutputSize({ width: 3000, height: 4000 }, '4K'), {
    width: 4096,
    height: 5460
  })
  assert.deepEqual(upscaleOutputSize({ width: 9000, height: 9000 }, '8K'), {
    width: 8192,
    height: 8192
  })
  assert.deepEqual(upscaleOutputSize({ width: 33, height: 25 }, 'original'), {
    width: 32,
    height: 24
  })
  assert.ok(upscaleSizeError({ width: 1920, height: 1080 }, '8K'))
  assert.equal(upscaleSizeError({ width: 4000, height: 3000 }, '8K'), '')
})
