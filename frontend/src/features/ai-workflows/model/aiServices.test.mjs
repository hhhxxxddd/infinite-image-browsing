import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCreationDefault } from './aiServices.ts'

const defaults = {
  image_edit: { mode: 'workflow', model: 'edit-model' },
  image_generation: { mode: 'router', model: 'generation-model' }
}

test('new creation sessions use the default for their own purpose', () => {
  assert.deepEqual(resolveCreationDefault('image_edit', null, defaults), defaults.image_edit)
  assert.deepEqual(
    resolveCreationDefault('image_generation', null, defaults),
    defaults.image_generation
  )
})

test('saved choices survive global defaults changes and hidden models', () => {
  const saved = { mode: 'router', model: 'previously-selected-model' }
  assert.deepEqual(resolveCreationDefault('image_edit', saved, defaults), saved)
  assert.equal(
    resolveCreationDefault('image_generation', { mode: 'workflow' }, defaults).mode,
    'workflow'
  )
})

test('older or unavailable configuration retains usable per-purpose fallbacks', () => {
  assert.equal(resolveCreationDefault('image_edit').mode, 'workflow')
  assert.equal(resolveCreationDefault('image_generation').mode, 'router')
  assert.equal(
    resolveCreationDefault('image_generation', null, {}).model,
    'vertexai/gemini-3.1-flash-image'
  )
})
