import test from 'node:test'
import assert from 'node:assert/strict'
import { findComfyWorkflow } from './comfyWorkflow.ts'
const workflow = {
  nodes: [
    { id: 1, type: 'KSampler' },
    { id: 2, type: 'CLIPTextEncode' }
  ],
  links: [],
  version: 0.4
}
const prompt = { 3: { class_type: 'KSampler', inputs: { seed: 0 } } }
test('recognizes embedded UI workflow and copies the complete graph, preferring it to API prompt', () => {
  const result = findComfyWorkflow({
    prompt: JSON.stringify(prompt),
    workflow: JSON.stringify(workflow)
  })
  assert.equal(result.nodeCount, 2)
  assert.deepEqual(JSON.parse(result.json), workflow)
})
test('recognizes API-only prompt, nested metadata and prefixed EXIF JSON', () => {
  assert.equal(findComfyWorkflow({ prompt: JSON.stringify(prompt) }).nodeCount, 1)
  assert.equal(
    findComfyWorkflow({ extraJsonMetaInfo: { extra_pnginfo: { workflow } } }).nodeCount,
    2
  )
  assert.equal(
    findComfyWorkflow({ ImageDescription: `workflow: ${JSON.stringify(workflow)}` }).nodeCount,
    2
  )
  assert.equal(findComfyWorkflow(JSON.stringify(prompt)).nodeCount, 1)
  const jpegExif = {
    Make: `prompt:${JSON.stringify(prompt)}`,
    Software: `workflow:${JSON.stringify(workflow)}`
  }
  assert.equal(findComfyWorkflow(jpegExif).nodeCount, 2)
  assert.deepEqual(JSON.parse(findComfyWorkflow(jpegExif).json), workflow)
})
test('ignores ordinary metadata, empty graphs, malformed JSON and cycles', () => {
  for (const value of [
    { prompt: 'portrait' },
    { workflow: '{bad' },
    { workflow: { nodes: [], links: [] } },
    { nodes: [{ id: 1 }] },
    { seed: 1 },
    undefined
  ])
    assert.equal(findComfyWorkflow(value), undefined)
  const cyclic = {}
  cyclic.metadata = cyclic
  assert.equal(findComfyWorkflow(cyclic), undefined)
})

test('node count inspection defers serialization until the copy value is requested', () => {
  let serializations = 0
  const large = {
    ...workflow,
    toJSON() {
      serializations++
      return workflow
    }
  }
  const result = findComfyWorkflow(large)
  assert.equal(result.nodeCount, 2)
  assert.equal(serializations, 0)
  assert.deepEqual(JSON.parse(result.json), workflow)
  assert.equal(serializations, 1)
})
