import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aiWorkflowParameterOverrides,
  initializeAIWorkflowParameters,
  validAIWorkflowParameters
} from './aiWorkflowParameters.ts'

const workflow = {
  id: 'w1',
  parameters: [
    { id: 'steps', name: '步数', kind: 'number', options: [], minimum: 1, maximum: 100, step: 1 },
    {
      id: 'enabled',
      name: '启用',
      kind: 'boolean',
      options: [],
      minimum: null,
      maximum: null,
      step: null
    },
    {
      id: 'style',
      name: '风格',
      kind: 'select',
      options: [{ name: '水彩', values: ['watercolor'] }],
      minimum: null,
      maximum: null,
      step: null
    }
  ],
  parameter_defaults: { steps: [24], enabled: [true] }
}

test('restores saved workflow parameter values and omits unchanged defaults', () => {
  const values = initializeAIWorkflowParameters(workflow, {
    workflowId: 'w1',
    values: { steps: 30, style: 0, enabled: true }
  })
  assert.equal(validAIWorkflowParameters(workflow, values), true)
  assert.deepEqual(aiWorkflowParameterOverrides(workflow, values), { steps: 30, style: 0 })
})

test('rejects values outside workflow bounds and select options', () => {
  const values = initializeAIWorkflowParameters(workflow)
  assert.equal(validAIWorkflowParameters(workflow, { ...values, steps: 101 }), false)
  assert.equal(validAIWorkflowParameters(workflow, { ...values, style: 1 }), false)
})
