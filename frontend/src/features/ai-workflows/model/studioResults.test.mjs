import assert from 'node:assert/strict'
import test from 'node:test'
import { workflowOutputMappings } from './workflowOutputs.ts'
import { studioTaskResults, imageResultBatches } from './studioResults.ts'

test('legacy mapping remains usable; an explicitly cleared list stays empty', () => {
  assert.deepEqual(workflowOutputMappings({ output_node_id: '4' }), [{ node_id: '4', label: '' }])
  assert.deepEqual(workflowOutputMappings({ output_node_id: '4', output_mappings: [] }), [])
  const mappings = [
    { node_id: '8', label: '背面' },
    { node_id: '4', label: '正面' }
  ]
  assert.deepEqual(
    workflowOutputMappings({ output_node_id: '4', output_mappings: mappings }),
    mappings
  )
})
test('all returned images remain ordered and legacy tasks expose their single image', () => {
  const results = [
    { artifact_id: 'a', label: '正面', node_id: '4' },
    { artifact_id: 'b', label: '背面', node_id: '8' }
  ]
  assert.deepEqual(studioTaskResults({ artifact_id: 'a', results }), results)
  assert.deepEqual(studioTaskResults({ artifact_id: 'old' }), [
    { artifact_id: 'old', label: '', node_id: '' }
  ])
  assert.deepEqual(studioTaskResults({ artifact_id: '', results: [] }), [])
})
test('result batches stay scoped to the current workspace and production, with partial saves visible', () => {
  const task = {
    id: 'old',
    workspace_id: 'w',
    document_id: 'p',
    artifact_id: 'a',
    created_at: 1,
    state: 'completed'
  }
  const partial = {
    ...task,
    id: 'partial',
    created_at: 2,
    state: 'failed',
    results: [{ artifact_id: 'b', label: '侧面', node_id: '5' }]
  }
  const tasks = [
    task,
    partial,
    { ...task, id: 'other', document_id: 'other' },
    { ...task, id: 'outside', workspace_id: 'outside' },
    { ...task, id: 'pending', artifact_id: '', state: 'running' }
  ]
  assert.deepEqual(
    imageResultBatches(tasks, 'w', 'p').map((item) => item.id),
    ['partial', 'old']
  )
  assert.deepEqual(
    imageResultBatches(tasks, 'w', 'other').map((item) => item.id),
    ['other']
  )
  assert.deepEqual(imageResultBatches(tasks, 'w'), [])
})

test('generation and editing in the same AI file keep separate result batches, including unscoped sessions', () => {
  const task = { workspace_id: 'w', document_id: 'p', artifact_id: 'a', created_at: 1 }
  const tasks = [
    { ...task, id: 'generation', purpose: 'image_generation' },
    { ...task, id: 'edit', purpose: 'image_edit', created_at: 2 },
    { ...task, id: 'unscoped', document_id: '', purpose: 'image_generation' }
  ]
  assert.deepEqual(
    imageResultBatches(tasks, 'w', 'p', 'image_generation').map((item) => item.id),
    ['generation']
  )
  assert.deepEqual(
    imageResultBatches(tasks, 'w', 'p', 'image_edit').map((item) => item.id),
    ['edit']
  )
  assert.deepEqual(
    imageResultBatches(tasks, 'w', undefined, 'image_generation').map((item) => item.id),
    ['unscoped']
  )
})
