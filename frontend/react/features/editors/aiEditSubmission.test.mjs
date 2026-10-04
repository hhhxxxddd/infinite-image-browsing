import assert from 'node:assert/strict'
import test from 'node:test'
import { planAIEditSubmission } from './aiEditSubmission.ts'
import { savedAIReferencePaths } from './aiEditInput.ts'

const inputs = {
  mainPath: 'main.png',
  referencePaths: ['a.png', 'b.png', 'c.png'],
  referenceLimit: 2,
  hasMask: true,
  useMask: true,
  supportsMask: true,
  providerLabel: '当前工作流'
}

test('unsupported inputs are omitted from submission without discarding the editor inputs', () => {
  const plan = planAIEditSubmission({ ...inputs, referenceLimit: 0, supportsMask: false })
  assert.deepEqual(plan.references, [])
  assert.equal(plan.submitMask, false)
  assert.deepEqual(plan.notices, [
    '当前工作流不支持参考图，本次忽略 3 张。',
    '当前工作流不支持遮罩，本次忽略。'
  ])
  assert.deepEqual(inputs.referencePaths, ['a.png', 'b.png', 'c.png'])
  const supported = planAIEditSubmission({ ...inputs, referenceLimit: 3 })
  assert.deepEqual(supported.references, inputs.referencePaths)
  assert.equal(supported.submitMask, true)
  assert.deepEqual(supported.notices, [])
})

test('submission uses numbered order and reports references beyond provider capacity', () => {
  const plan = planAIEditSubmission(inputs)
  assert.deepEqual(plan.references, ['a.png', 'b.png'])
  assert.deepEqual(plan.notices, ['本次使用前 2 张参考图，其余 1 张忽略。'])
  assert.equal(plan.submitMask, true)
})

test('disabled or absent mask is not sent, and main image and duplicate references are excluded', () => {
  const plan = planAIEditSubmission({
    ...inputs,
    useMask: false,
    referencePaths: ['main.png', 'a.png', 'a.png', '', 'b.png']
  })
  assert.equal(plan.submitMask, false)
  assert.deepEqual(plan.references, ['a.png', 'b.png'])
  assert.deepEqual(plan.notices, [])
  assert.equal(planAIEditSubmission({ ...inputs, hasMask: false }).submitMask, false)
})

test('saved input lists restore more than thirteen references, independently of provider choice', () => {
  const references = Array.from({ length: 20 }, (_, i) => `reference-${i}.png`)
  const storage = {
    getItem: () => JSON.stringify([...references, 'main.png', references[0], '', 3])
  }
  assert.deepEqual(savedAIReferencePaths(storage, 'draft', 'main.png'), references)
})
