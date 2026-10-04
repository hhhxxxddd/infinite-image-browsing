import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aiTaskStatusLabel } from './aiTaskStatus.ts'

test('late cancellation cannot hide a completed or interrupted task', () => {
  assert.equal(aiTaskStatusLabel({ state: 'running', cancel_requested: true }), '正在取消')
  assert.equal(aiTaskStatusLabel({ state: 'completed', cancel_requested: true }), '已完成')
  assert.equal(aiTaskStatusLabel({ state: 'interrupted', cancel_requested: true }), '跟踪中断')
})

test('queue position is shown only while the provider is queuing', () => {
  assert.equal(
    aiTaskStatusLabel({ state: 'running', phase: 'cloud_queued', queue_position: 4 }),
    '前方 4 个任务'
  )
  assert.equal(
    aiTaskStatusLabel({ state: 'running', phase: 'processing', queue_position: 4 }),
    '处理中'
  )
  assert.equal(
    aiTaskStatusLabel({ state: 'running', phase: 'cloud_queued', queue_position: null }),
    '云端排队'
  )
})
