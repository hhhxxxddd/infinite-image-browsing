import test from 'node:test'
import assert from 'node:assert/strict'
import { copyableGenerationInfo, getGenerationResources } from './generationResources.ts'

test('shows checkpoint and distinct LoRA names from prompt and ComfyUI metadata', () => {
  assert.deepEqual(getGenerationResources({
    resources: [{ type: 'lora', name: 'portrait_style-v2', weight: 0.75 }],
    Model: 'base.safetensors',
    LoRA: 'portrait_style-v2; 中文 风格',
    'Lora hashes': 'portrait_style-v2: abcd1234',
  }), [
    { type: 'model', name: 'base.safetensors' },
    { type: 'lora', name: 'portrait_style-v2', weight: 0.75, hash: 'abcd1234' },
    { type: 'lora', name: '中文 风格' },
  ])
  assert.deepEqual(getGenerationResources({ Model: 'None', resources: [{ type: 'model', name: 'Unknown' }] }), [])
})

test('copy all omits checkpoint and LoRA identities but keeps ordinary generation fields', () => {
  const raw = 'portrait, <lora:portrait_style-v2:0.75>, soft light\n' +
    'Negative prompt: blur\n' +
    'Steps: 20, Model: base.safetensors, Model hash: abcd, LoRA: 中文 风格, Lora hashes: "portrait_style-v2: efgh", Sampler: Euler, Seed: 42'
  const copied = copyableGenerationInfo(raw)
  assert.match(copied, /portrait/)
  assert.match(copied, /Steps: 20/)
  assert.match(copied, /Sampler: Euler/)
  assert.match(copied, /Seed: 42/)
  assert.doesNotMatch(copied, /portrait_style-v2|base\.safetensors|中文 风格|efgh|abcd/)
})

test('copying structured metadata removes nested model and LoRA fields', () => {
  const copied = JSON.parse(copyableGenerationInfo(JSON.stringify({
    inputs: { model: ['3', 0], ckpt_name: 'base.safetensors', lora_name: 'style.safetensors', seed: 42 },
    prompt: 'portrait <lora:style.safetensors:1>',
    resources: [{ type: 'lora', name: 'style.safetensors' }],
  })))
  assert.deepEqual(copied, { inputs: { model: ['3', 0], seed: 42 }, prompt: 'portrait' })
})

test('copy all keeps unrelated extra metadata while omitting resource names', () => {
  const raw = 'portrait\nSteps: 20, Model: base.safetensors, LoRA: style.safetensors\n' +
    'extraJsonMetaInfo: {"note":"reviewed","resources":[{"type":"lora","name":"style.safetensors"}],"workflow":{"inputs":{"model":["3",0],"lora_name":"style.safetensors"}}}'
  const copied = copyableGenerationInfo(raw)
  assert.match(copied, /Steps: 20/)
  assert.match(copied, /reviewed/)
  assert.match(copied, /"model":\["3",0\]/)
  assert.doesNotMatch(copied, /base\.safetensors|style\.safetensors/)
})
