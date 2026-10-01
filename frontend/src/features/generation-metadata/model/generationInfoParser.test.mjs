import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from './generationInfoParser.ts'
import { readGenerationDraft, writeGenerationDraft, setParameter } from './generationInfoDraft.ts'
import { appendGenerationResource, getGenerationResources } from './generationResources.ts'

test('the parser and writer roundtrip quoted names, nested JSON and Windows paths', () => {
  const draft = readGenerationDraft('a portrait\nNegative prompt: blur')
  const name = 'folder\\base, "portrait".safetensors'
  draft.parameters = setParameter('Seed: 0, Hashes: {"a":"abc","b":"def"}', 'Model', name)
  const meta = parse(writeGenerationDraft(draft))
  assert.equal(meta.Model, name)
  assert.equal(meta.seed, 0)
  assert.deepEqual(meta.hashes, { a: 'abc', b: 'def' })
  assert.equal(meta.negativePrompt, 'blur')
})
test('malformed field types do not crash the preview', () => {
  for (const raw of [
    'Size: 512',
    'Size: {"width":10}',
    'Steps: 1, Hashes: null, Model: base, Model hash: abc',
    'Steps: 1, AddNet Enabled: True, AddNet Model 1: 123'
  ])
    assert.doesNotThrow(() => parse(raw))
  assert.equal(parse('Size: 720 × 1280').height, 1280)
  assert.equal(parse('Size: 512').width, undefined)
})
test('raw workflow JSON is not displayed as a positive prompt', () => {
  assert.deepEqual(parse('{"nodes":[],"links":[]}'), {})
})

test('weighted prompts and large seeds retain their original text', () => {
  const meta = parse('[red hair], portrait\nSeed: 18446744073709551615')
  assert.equal(meta.prompt, '[red hair], portrait')
  assert.equal(meta.seed, '18446744073709551615')
})
test('resource additions remain visible after full serialization and parsing', () => {
  let raw = 'portrait <lora:style:0.4>\nSteps: 20'
  raw = appendGenerationResource(raw, { type: 'lora', name: 'style', weight: 0 })
  raw = appendGenerationResource(raw, { type: 'upscaler', name: '4x' })
  const resources = getGenerationResources(parse(raw))
  assert.equal(resources.length, 2)
  assert.equal(resources.find((resource) => resource.type === 'lora').weight, 0)
  assert.equal(resources.find((resource) => resource.type === 'upscaler').name, '4x')
})

test('ComfyUI LoRA fields are shown without needing a LoRA prompt token', () => {
  const model = 'models\\base, "portrait".safetensors'
  const lora = 'loras\\style, "中文".safetensors'
  const raw = `portrait\nNegative prompt: blur\nSteps: 24, Sampler: euler, Model: ${JSON.stringify(model)}, LoRA: ${JSON.stringify(lora)}, Source Identifier: ComfyUI`
  assert.deepEqual(getGenerationResources(parse(raw)), [
    { type: 'model', name: model },
    { type: 'lora', name: lora }
  ])
})
