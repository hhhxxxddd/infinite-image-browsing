import assert from 'node:assert/strict'
import test from 'node:test'
import { generationDetails } from './generationDetails.ts'

test('both previews retain models, LoRA, standard parameters and additional metadata', () => {
  const details = generationDetails(
    {
      Model: 'base',
      LoRA: 'detail',
      seed: 0,
      steps: 20,
      sampler: 'Euler',
      cfgScale: 7,
      extraJsonMetaInfo: { job_id: 'job', model: 'router' },
      custom: 'value'
    },
    720,
    1280
  )
  assert.equal(details.resources[0].name, 'base')
  assert.equal(details.resources[1].type, 'lora')
  assert.equal(details.primary.find((p) => p.key === 'Seed').value, '0')
  assert.equal(details.primary.find((p) => p.key === 'Size').value, '720 × 1280')
  assert.equal(details.more.find((p) => p.key === 'custom').value, 'value')
  assert.match(details.more.find((p) => p.key === '补充信息').value, /job/)
})
test('API models are identified separately and unavailable generation parameters remain empty', () => {
  const details = generationDetails({ extraJsonMetaInfo: { model: 'api-model' } })
  assert.deepEqual(details.resources, [{ type: 'API 模型', name: 'api-model' }])
  assert.equal(details.primary.find((p) => p.key === 'Seed').value, '')
})

test('compact detail rendering does not stringify hidden workflow metadata', () => {
  let serializations = 0
  const extra = {
    workflow: {
      toJSON() {
        serializations++
        return { nodes: [] }
      }
    }
  }
  const details = generationDetails(
    { seed: 0, extraJsonMetaInfo: extra },
    undefined,
    undefined,
    false
  )
  assert.equal(serializations, 0)
  assert.deepEqual(details.more, [])
  assert.equal(details.primary.find((p) => p.key === 'Seed').value, '0')
})
