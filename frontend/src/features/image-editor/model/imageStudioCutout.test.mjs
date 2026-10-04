import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudioDocument, createImageLayer, createStudioGroup } from './imageStudioModel.ts'
import { studioFrameWorldPoint } from './imageStudioGeometry.ts'
import {
  applyCutoutResult,
  recoverImageToolResult,
  acceptedImageToolJobs,
  cutoutRevision,
  cutoutLocalPoint,
  cutoutBox,
  cutoutInputLayer,
  currentCutoutJobs,
  cutoutBeforeDocument,
  previousCutout
} from './imageStudioCutout.ts'
import { imageToolInputSize, upscaleOutputSize } from './imageStudioUpscale.ts'

test('acknowledged and adopted unsaved results can be explicitly recovered against the exact source', () => {
  for (const tool_id of ['image-cutout-sam3', 'image-upscale', 'image-erase']) {
    const { doc, layer, job } = fixture()
    const accepted = { ...job, tool_id, handled: true, accepted_at: 10 }
    assert.equal(applyCutoutResult(doc, accepted), undefined)
    const restored = recoverImageToolResult(doc, accepted)
    assert.equal(restored.layers[0].path, job.result.path)
    assert.equal(recoverImageToolResult(restored, accepted), undefined)
    assert.equal(recoverImageToolResult({ ...doc, layers: [] }, accepted), undefined)
    assert.equal(
      recoverImageToolResult({ ...doc, layers: [{ ...layer, locked: true }] }, accepted),
      undefined
    )
    assert.equal(
      recoverImageToolResult({ ...doc, layers: [{ ...layer, brightness: 101 }] }, accepted),
      undefined
    )
    assert.equal(recoverImageToolResult(doc, { ...accepted, superseded: true }), undefined)
  }
})

test('adoption ends every old tool comparison and makes the current result the next input', () => {
  for (const tool_id of ['image-cutout-sam3', 'image-upscale', 'image-erase']) {
    const { doc, layer, job } = fixture()
    Object.assign(job, {
      tool_id,
      created_at: 1,
      source: { path: 'editor-asset:input', width: 200, height: 100 },
      result: { path: 'editor-asset:result', width: 400, height: 200 }
    })
    if (tool_id === 'image-cutout-sam3')
      job.result_bounds = { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }
    const after = applyCutoutResult(doc, job)
    const jobs = acceptedImageToolJobs([job], new Map([[layer.id, 2]]))
    assert.equal(previousCutout(after.layers[0], jobs), undefined)
    assert.equal(cutoutBeforeDocument(after, jobs[0]), after)
    assert.equal(applyCutoutResult(doc, jobs[0]), undefined)
    assert.equal(after.layers[0].path, job.result.path)
    // The resulting native size, including cropped output, now drives the next round.
    const input = imageToolInputSize(after.layers[0], job.result)
    assert.deepEqual(input, { width: 400, height: 200 })
    assert.deepEqual(upscaleOutputSize(input, 2), { width: 800, height: 400 })
    const nextJob = {
      ...job,
      id: 'next',
      created_at: 3,
      source_revision: cutoutRevision(after.layers[0]),
      source: job.result,
      result_bounds: null,
      result: { ...job.result, path: 'editor-asset:next' }
    }
    const next = applyCutoutResult(after, nextJob)
    assert.equal(next.layers[0].width, after.layers[0].width)
    assert.equal(previousCutout(next.layers[0], [...jobs, nextJob]), nextJob)
  }
})

test('unsaved repeated trimmed results recover from the original or an intermediate saved input', () => {
  const { doc, job } = fixture()
  job.result_bounds = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 }
  const first = applyCutoutResult(doc, job)
  const second = {
    ...job,
    id: 'second',
    source_revision: cutoutRevision(first.layers[0]),
    source_bounds: job.result_bounds,
    result_bounds: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
    result: { path: 'editor-asset:second' }
  }
  const twice = applyCutoutResult(first, second)
  const third = {
    ...second,
    id: 'third',
    source_revision: cutoutRevision(twice.layers[0]),
    source_bounds: second.result_bounds,
    result_bounds: null,
    result: { path: 'editor-asset:third' },
    recovery_steps: [job, second].map(
      ({ source_revision, source_bounds, result_bounds, result }) => ({
        source_revision,
        source_bounds,
        result_bounds,
        result
      })
    )
  }
  const expected = applyCutoutResult(twice, third)
  for (const saved of [doc, first, twice]) {
    const original = structuredClone(saved)
    const restored = recoverImageToolResult(saved, { ...third, accepted_at: 10, handled: true })
    assert.equal(restored.layers[0].path, expected.layers[0].path)
    for (const key of ['x', 'y', 'width', 'height', 'rotation'])
      assert.ok(Math.abs(restored.layers[0][key] - expected.layers[0][key]) < 1e-10)
    assert.equal(restored.layers[1], saved.layers[1])
    assert.deepEqual(saved, original)
  }
  assert.equal(
    recoverImageToolResult({ ...doc, layers: [{ ...doc.layers[0], brightness: 101 }] }, third),
    undefined
  )
})

test('recovery follows exact revisions across tools and does not take unrelated or canceled branches', () => {
  const { doc, job } = fixture()
  const first = { ...job, tool_id: 'image-cutout-sam3' }
  const afterFirst = applyCutoutResult(doc, first)
  const second = {
    ...job,
    id: 'upscale',
    tool_id: 'image-upscale',
    source_revision: cutoutRevision(afterFirst.layers[0]),
    result: { path: 'editor-asset:upscaled' }
  }
  const afterSecond = applyCutoutResult(afterFirst, second)
  const target = {
    ...job,
    id: 'erase',
    tool_id: 'image-erase',
    source_revision: cutoutRevision(afterSecond.layers[0]),
    result: { path: 'editor-asset:erased' }
  }
  const unrelated = { ...first, result: { path: 'editor-asset:another-branch' } }
  assert.equal(recoverImageToolResult(doc, target, [unrelated, second]), undefined)
  assert.equal(
    recoverImageToolResult(doc, target, [{ ...first, state: 'canceled' }, second]),
    undefined
  )
  assert.equal(
    recoverImageToolResult(doc, target, [{ ...first, layer_id: 'another' }, second]),
    undefined
  )
  const restored = recoverImageToolResult(doc, target, [
    unrelated,
    { ...first, accepted_at: 1 },
    { ...second, accepted_at: 2 }
  ])
  assert.deepEqual(restored, applyCutoutResult(afterSecond, target))
})

test('stale polls cannot reopen adopted buffers, including identical pixels from other tools', () => {
  const { doc, layer, job } = fixture()
  const old = { ...job, created_at: 1 }
  const adopted = { ...job, id: 'adopted', created_at: 2, tool_id: 'image-upscale' }
  const newer = { ...job, id: 'newer', created_at: 4, tool_id: 'image-erase' }
  const other = { ...job, layer_id: 'other', created_at: 1 }
  const jobs = acceptedImageToolJobs([old, adopted, newer, other], new Map([[layer.id, 3]]))
  const current = applyCutoutResult(doc, job).layers[0]
  assert.equal(
    previousCutout(
      current,
      jobs.filter((j) => !j.tool_id)
    ),
    undefined
  )
  assert.equal(
    previousCutout(
      current,
      jobs.filter((j) => j.tool_id === 'image-upscale')
    ),
    undefined
  )
  assert.equal(
    previousCutout(
      current,
      jobs.filter((j) => j.tool_id === 'image-erase')
    ),
    newer
  )
  assert.equal(jobs[3], other)
  assert.equal(
    currentCutoutJobs([old, { ...old, id: 'latest', created_at: 2, accepted_at: 3 }]).length,
    1
  )
})

function fixture() {
  const doc = createStudioDocument()
  const layer = createImageLayer('/original.png', { x: 50, y: 75, width: 200, height: 100 })
  Object.assign(layer, {
    crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.7 },
    rotation: 37,
    flipX: true,
    brightness: 120,
    opacity: 0.6
  })
  doc.layers = [layer, createImageLayer('/other.png', { x: 300, y: 20, width: 50, height: 50 })]
  const job = {
    id: 'job',
    layer_id: layer.id,
    source_revision: cutoutRevision(layer),
    state: 'completed',
    source: { path: 'editor-asset:input' },
    result: { path: 'editor-asset:result' }
  }
  return { doc, layer, job }
}
test('point mapping accounts for rotation and local frame; reverse box drags are normalized', () => {
  const { layer } = fixture()
  for (const [x, y] of [
    [0, 0],
    [100, 25],
    [200, 100]
  ]) {
    const point = cutoutLocalPoint(layer, studioFrameWorldPoint(layer, { x, y }))
    assert.ok(Math.abs(point.x - x / 200) < 1e-12)
    assert.ok(Math.abs(point.y - y / 100) < 1e-12)
  }
  assert.deepEqual(cutoutBox({ x: 0.75, y: 0.8 }, { x: 0.25, y: 0.3 }), {
    x: 0.25,
    y: 0.3,
    width: 0.5,
    height: 0.5
  })
})
test('async result replaces only pixels, keeps latest geometry, stack and groups, clears baked transforms', () => {
  const { doc, layer, job } = fixture()
  const group = createStudioGroup()
  doc.groups.push(group)
  Object.assign(layer, {
    x: -40,
    y: 600,
    rotation: -50,
    name: 'renamed',
    groupId: group.id,
    opacity: 0.4,
    width: 400,
    height: 200
  })
  const original = structuredClone(doc)
  const next = applyCutoutResult(doc, job)
  assert.deepEqual(doc, original)
  assert.equal(next.layers[1], doc.layers[1])
  for (const key of ['id', 'name', 'x', 'y', 'width', 'height', 'rotation', 'groupId', 'opacity'])
    assert.equal(next.layers[0][key], layer[key])
  assert.equal(next.layers[0].path, job.result.path)
  assert.equal(next.layers[0].brightness, 100)
  assert.equal(next.layers[0].flipX, false)
  assert.deepEqual(next.layers[0].crop, { x: 0, y: 0, width: 1, height: 1 })
  assert.equal(previousCutout(next.layers[0], [job]), job)
  assert.equal(
    previousCutout(
      { ...next.layers[0], path: job.result.path.replace('editor-asset:', 'snapshot:') },
      [job]
    ),
    job
  )
  assert.equal(previousCutout({ ...next.layers[0], brightness: 120 }, [job]), undefined)
})
test('deleted, locked, replaced, cropped, reshaped or canceled targets cannot be overwritten or resurrected', () => {
  for (const patch of [
    { path: '/replaced' },
    { locked: true },
    { brightness: 50 },
    { width: 150 },
    { crop: { x: 0, y: 0, width: 0.2, height: 0.2 } }
  ]) {
    const { doc, layer, job } = fixture()
    Object.assign(layer, patch)
    assert.equal(applyCutoutResult(doc, job), undefined)
  }
  const { doc, job } = fixture()
  assert.equal(applyCutoutResult(doc, { ...job, state: 'canceled' }), undefined)
  doc.layers.shift()
  assert.equal(applyCutoutResult(doc, job), undefined)
})

test('trimmed results preserve subject canvas coordinates after moving a rotated layer', () => {
  const { doc, layer, job } = fixture()
  layer.x += 87
  layer.y -= 32
  job.result_bounds = { x: 0.15, y: 0.2, width: 0.4, height: 0.7 }
  const next = applyCutoutResult(doc, job)
  const result = next.layers[0]
  assert.equal(result.width, 80)
  assert.equal(result.height, 70)
  assert.equal(result.rotation, layer.rotation)
  for (const [x, y] of [
    [0, 0],
    [0.5, 0.4],
    [1, 1]
  ]) {
    const before = studioFrameWorldPoint(layer, {
      x: (job.result_bounds.x + x * job.result_bounds.width) * layer.width,
      y: (job.result_bounds.y + y * job.result_bounds.height) * layer.height
    })
    const after = studioFrameWorldPoint(result, { x: x * result.width, y: y * result.height })
    assert.ok(Math.abs(before.x - after.x) < 1e-10)
    assert.ok(Math.abs(before.y - after.y) < 1e-10)
  }
  const restored = cutoutInputLayer(result, job.result_bounds)
  for (const key of ['x', 'y', 'width', 'height', 'rotation'])
    assert.ok(Math.abs(restored[key] - layer[key]) < 1e-10)
})

test('re-cutting a cropped result uses original input coordinates without cumulative shrinking', () => {
  const { doc, layer, job } = fixture()
  job.result_bounds = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 }
  const first = applyCutoutResult(doc, job)
  const cropped = first.layers[0]
  cropped.x += 45
  cropped.y += 15
  const repeated = {
    ...job,
    source_revision: cutoutRevision(cropped),
    source_bounds: job.result_bounds
  }
  const again = applyCutoutResult(first, repeated).layers[0]
  for (const key of ['x', 'y', 'width', 'height'])
    assert.ok(Math.abs(again[key] - cropped[key]) < 1e-10)
  const full = applyCutoutResult(first, {
    ...repeated,
    result_bounds: { x: 0, y: 0, width: 1, height: 1 }
  }).layers[0]
  assert.ok(Math.abs(full.x - layer.x - 45) < 1e-10)
  assert.ok(Math.abs(full.y - layer.y - 15) < 1e-10)
  assert.equal(full.width, layer.width)
  assert.equal(full.height, layer.height)
  assert.equal(previousCutout(cropped, [job]), job)
})

test('only the latest successful pair survives, while retries and other layers stay independent', () => {
  const { doc, job } = fixture()
  const old = { ...job, id: 'old', created_at: 1, result: { path: 'editor-asset:old' } }
  const newest = { ...job, id: 'new', created_at: 2 }
  const failure = { ...job, id: 'retry', created_at: 3, state: 'failed', result: undefined }
  const other = { ...job, id: 'other', layer_id: 'another-layer', created_at: 4 }
  const rows = currentCutoutJobs([old, other, newest, failure])
  assert.deepEqual(
    rows.map((item) => item.id),
    ['other', 'retry', 'new']
  )
  const layer = applyCutoutResult(doc, newest).layers[0]
  assert.equal(previousCutout(layer, rows), newest)
  assert.equal(previousCutout({ ...layer, path: old.result.path }, [old, newest]), undefined)
})

test('before comparison restores only the selected input and does not mutate the result or other layers', () => {
  const { doc, layer, job } = fixture()
  job.result_bounds = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 }
  layer.frameId = 'frame'
  const result = applyCutoutResult(doc, job)
  result.layers[0].x += 45
  result.layers[0].y += 15
  const saved = structuredClone(result)
  const comparison = cutoutBeforeDocument(result, job)
  assert.equal(comparison.layers[0].path, job.source.path)
  assert.equal(comparison.layers[0].frameId, 'frame')
  assert.equal(comparison.layers[0].opacity, layer.opacity)
  assert.ok(Math.abs(comparison.layers[0].x - layer.x - 45) < 1e-10)
  assert.ok(Math.abs(comparison.layers[0].y - layer.y - 15) < 1e-10)
  assert.equal(comparison.layers[0].width, layer.width)
  assert.equal(comparison.layers[0].height, layer.height)
  assert.equal(comparison.layers[1], result.layers[1])
  assert.equal(comparison.groups, result.groups)
  assert.deepEqual(result, saved)
  assert.equal(cutoutBeforeDocument(result), result)
  assert.equal(cutoutBeforeDocument(doc, job), doc)
})
