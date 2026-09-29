import assert from 'node:assert/strict'
import test from 'node:test'
import { parameterSliderRange } from './workflowParameters.ts'

const parameter = { kind: 'number', number_display: 'slider', minimum: 0, maximum: 1, step: 0.05 }

test('slider keeps fractional bounds and step without changing the numeric value', () => {
  assert.deepEqual(parameterSliderRange(parameter), { min: 0, max: 1, step: 0.05 })
  assert.deepEqual(parameterSliderRange({ ...parameter, minimum: -10, maximum: 10, step: 1 }), {
    min: -10,
    max: 10,
    step: 1
  })
})

test('old workflows and ordinary numeric inputs do not acquire a slider', () => {
  assert.equal(parameterSliderRange({ ...parameter, number_display: undefined }), null)
  assert.equal(parameterSliderRange({ ...parameter, number_display: 'input' }), null)
  assert.equal(parameterSliderRange({ ...parameter, kind: 'text' }), null)
})

test('incomplete and unusable slider ranges fall back to the number input', () => {
  for (const patch of [
    { minimum: null },
    { maximum: null },
    { step: null },
    { minimum: Infinity },
    { maximum: NaN },
    { step: Infinity },
    { minimum: 1 },
    { minimum: 2 },
    { step: 0 },
    { step: -1 },
    { step: 2 },
    { minimum: -Number.MAX_VALUE, maximum: Number.MAX_VALUE }
  ])
    assert.equal(parameterSliderRange({ ...parameter, ...patch }), null)
})
