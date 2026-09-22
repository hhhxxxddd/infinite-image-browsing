import test from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationDraft, writeGenerationDraft, readParameter, setParameter } from './generationInfoDraft.ts'

test('roundtrips multiline prompts, parameters, and structured extra data', () => {
  const raw = 'a cat\non a hill\nNegative prompt: blur\nlow quality\nSteps: 30, Seed: 0, CFG scale: 7\nextraJsonMetaInfo: {"note":"v1","workflow":{"id":5}}'
  const draft = readGenerationDraft(raw)
  assert.equal(draft.positive, 'a cat\non a hill')
  assert.equal(draft.negative, 'blur\nlow quality')
  assert.deepEqual(readGenerationDraft(writeGenerationDraft(draft)), draft)
})
test('allows parameter-only metadata without inventing generation values', () => {
  const draft = readGenerationDraft('')
  draft.parameters = 'Seed: 0, Model: custom-model'
  const saved = writeGenerationDraft(draft)
  assert.equal(saved.includes('Steps:'), false)
  assert.equal(readGenerationDraft(saved).parameters, draft.parameters)
  assert.equal(readGenerationDraft(saved).positive, '')
})
test('rejects invalid structured metadata instead of silently discarding it', () => {
  const draft = readGenerationDraft('')
  draft.extra = '{invalid}'
  assert.throws(() => writeGenerationDraft(draft))
  draft.extra = '[]'
  assert.throws(() => writeGenerationDraft(draft), /JSON 对象/)
})
test('marks JSON and nonstandard parameter layouts for original-text editing', () => {
  assert.equal(readGenerationDraft('{"workflow": {}}').rawPreferred, true)
  assert.equal(readGenerationDraft('prompt\nSteps: 20\nSeed: 30').rawPreferred, true)
})

test('editing individual parameters preserves zero, quoted commas and unknown fields', () => {
  const raw = 'Seed: 0, Model: "one, two", Hashes: {"a": "x", "b": "y"}, Custom: keep'
  assert.equal(readParameter(raw, 'Seed'), '0')
  assert.equal(readParameter(raw, 'Model'), 'one, two')
  const updated = setParameter(raw, 'Model', 'three, four')
  assert.equal(readParameter(updated, 'Model'), 'three, four')
  assert.equal(readParameter(updated, 'Custom'), 'keep')
  assert.equal(readParameter(updated, 'Hashes'), '{"a": "x", "b": "y"}')
  assert.equal(readParameter(setParameter(updated, 'Seed', ''), 'Seed'), '')
  assert.equal(readParameter(setParameter(updated, 'Steps', '20'), 'Steps'), '20')
})
