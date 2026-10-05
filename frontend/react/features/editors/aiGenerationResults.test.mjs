import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generationTaskResults, selectGenerationResult } from './aiGenerationResults.ts'

const task = (overrides = {}) => ({
  id: 'task-1',
  workspace_id: 'workspace-1',
  document_id: 'draft-1',
  purpose: 'image_generation',
  state: 'completed',
  name: '同名制作文件',
  created_at: 10,
  artifact_id: 'image-1',
  ...overrides
})

test('generation preview never crosses workspaces, production files, or edit tasks', () => {
  const results = generationTaskResults(
    [
      task(),
      task({ workspace_id: 'other' }),
      task({ document_id: 'other' }),
      task({ document_id: undefined }),
      task({ purpose: 'image_edit' }),
      task({ purpose: undefined }),
      task({ state: 'running' })
    ],
    'workspace-1',
    'draft-1'
  )
  assert.deepEqual(results, [{ artifactId: 'image-1', label: '同名制作文件', taskId: 'task-1' }])
})

test('generation gallery orders batches by creation time and preserves all distinct mapped outputs', () => {
  const results = generationTaskResults(
    [
      task({
        id: 'new',
        created_at: 20,
        results: [
          { artifact_id: 'image-2', label: '画面' },
          { artifact_id: 'image-3', label: '细节' },
          { artifact_id: 'image-2', label: '重复' },
          { artifact_id: '', label: '空' }
        ]
      }),
      task(),
      task({ id: 'empty', artifact_id: '' })
    ],
    'workspace-1',
    'draft-1'
  )
  assert.deepEqual(
    results.map((result) => result.artifactId),
    ['image-2', 'image-3', 'image-1']
  )
  assert.equal(results[1].label, '细节')
  assert.equal(results[1].taskId, 'new')
})

test('deleted generation outputs stay hidden after refresh while surviving results remain selectable', () => {
  const batch = task({
    results: [
      { artifact_id: 'image-1', label: '已删除' },
      { artifact_id: 'image-2', label: '保留' },
      { artifact_id: 'image-3', label: '当前会话删除' }
    ],
    deleted_artifact_ids: ['image-1']
  })
  const results = generationTaskResults([batch], 'workspace-1', 'draft-1', new Set(['image-3']))
  assert.deepEqual(
    results.map((result) => result.artifactId),
    ['image-2']
  )
  assert.equal(selectGenerationResult(results, 'image-1', 'image-1'), 'image-2')
  assert.equal(batch.results.length, 3)
  assert.deepEqual(
    generationTaskResults([task({ deleted_artifact_ids: ['image-1'] })], 'workspace-1', 'draft-1'),
    []
  )
})

test('restored selection survives refresh and a newly completed batch takes the stage', () => {
  const results = generationTaskResults(
    [task(), task({ artifact_id: 'new', created_at: 20 })],
    'workspace-1',
    'draft-1'
  )
  assert.equal(selectGenerationResult(results, 'image-1', ''), 'image-1')
  assert.equal(selectGenerationResult(results, 'image-1', 'new'), 'image-1')
  assert.equal(selectGenerationResult(results, 'image-1', 'image-1'), 'new')
  assert.equal(selectGenerationResult(results, 'deleted', 'new'), 'new')
  assert.equal(selectGenerationResult([], 'image-1', 'image-1'), '')
})
