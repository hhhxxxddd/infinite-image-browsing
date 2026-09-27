import test from 'node:test'
import assert from 'node:assert/strict'
import {
  copyableGenerationInfo,
  getGenerationResources,
  appendGenerationResource,
  parseResourceWeight
} from './generationResources.ts'

test('shows checkpoint and distinct LoRA names from prompt and ComfyUI metadata', () => {
  assert.deepEqual(
    getGenerationResources({
      resources: [{ type: 'lora', name: 'portrait_style-v2', weight: 0.75 }],
      Model: 'base.safetensors',
      LoRA: 'portrait_style-v2; 中文 风格',
      'Lora hashes': 'portrait_style-v2: abcd1234'
    }),
    [
      { type: 'model', name: 'base.safetensors' },
      { type: 'lora', name: 'portrait_style-v2', weight: 0.75, hash: 'abcd1234' },
      { type: 'lora', name: '中文 风格' }
    ]
  )
  assert.deepEqual(
    getGenerationResources({ Model: 'None', resources: [{ type: 'model', name: 'Unknown' }] }),
    []
  )
})

test('copy all omits checkpoint and LoRA identities but keeps ordinary generation fields', () => {
  const raw =
    'portrait, <lora:portrait_style-v2:0.75>, soft light\n' +
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
  const copied = JSON.parse(
    copyableGenerationInfo(
      JSON.stringify({
        inputs: {
          model: ['3', 0],
          ckpt_name: 'base.safetensors',
          lora_name: 'style.safetensors',
          seed: 42
        },
        prompt: 'portrait <lora:style.safetensors:1>',
        resources: [{ type: 'lora', name: 'style.safetensors' }]
      })
    )
  )
  assert.deepEqual(copied, { inputs: { model: ['3', 0], seed: 42 }, prompt: 'portrait' })
})

test('copy all keeps unrelated extra metadata while omitting resource names', () => {
  const raw =
    'portrait\nSteps: 20, Model: base.safetensors, LoRA: style.safetensors\n' +
    'extraJsonMetaInfo: {"note":"reviewed","resources":[{"type":"lora","name":"style.safetensors"}],"workflow":{"inputs":{"model":["3",0],"lora_name":"style.safetensors"}}}'
  const copied = copyableGenerationInfo(raw)
  assert.match(copied, /Steps: 20/)
  assert.match(copied, /reviewed/)
  assert.match(copied, /"model":\["3",0\]/)
  assert.doesNotMatch(copied, /base\.safetensors|style\.safetensors/)
})

test('adding typed resources preserves prompts, zero weight, and unrelated structured metadata', async () => {
  const { readGenerationDraft } = await import('./generationInfoDraft.ts')
  let raw =
    'portrait <lora:existing:0.4>\nNegative prompt: blur\nSteps: 20, Seed: 0\nextraJsonMetaInfo: {"note":"keep","workflow":{"id":123}}'
  for (const resource of [
    { type: 'lora', name: 'new style', weight: 0 },
    { type: 'lora', name: 'second', weight: 0.8 },
    { type: 'upscaler', name: '4x-model' },
    { type: 'vae', name: 'vae-model' }
  ])
    raw = appendGenerationResource(raw, resource)
  const draft = readGenerationDraft(raw)
  assert.equal(draft.positive, 'portrait <lora:existing:0.4>')
  assert.equal(draft.negative, 'blur')
  assert.equal(draft.parameters, 'Steps: 20, Seed: 0')
  const extra = JSON.parse(draft.extra)
  assert.equal(extra.note, 'keep')
  assert.deepEqual(extra.workflow, { id: 123 })
  assert.equal(getGenerationResources({ extraJsonMetaInfo: extra })[0].weight, 0)
  assert.equal(extra.resources.length, 4)
  raw = appendGenerationResource(raw, { type: 'lora', name: 'new style', weight: 1 })
  assert.equal(JSON.parse(readGenerationDraft(raw).extra).resources.length, 4)
  assert.throws(
    () =>
      appendGenerationResource('portrait\nextraJsonMetaInfo: {"resources":{}}', {
        type: 'lora',
        name: 'x'
      }),
    /不是列表/
  )
  assert.throws(
    () => appendGenerationResource('{"workflow":{}}', { type: 'lora', name: 'x' }),
    /原文编辑/
  )
})

test('maps VAE, upscaler and checkpoint aliases without losing hash or weight', () => {
  const resources = getGenerationResources({
    Model: 'base',
    VAE: 'vae',
    'VAE hash': 'abc',
    'Hires upscaler': '4x',
    extraJsonMetaInfo: {
      resources: [
        { type: 'checkpoint', name: 'base', hash: 'xyz' },
        { type: 'controlnet', name: 'depth', weight: 0 }
      ]
    }
  })
  assert.deepEqual(resources, [
    { type: 'model', name: 'base', hash: 'xyz' },
    { type: 'vae', name: 'vae', hash: 'abc' },
    { type: 'upscaler', name: '4x' },
    { type: 'controlnet', name: 'depth', weight: 0 }
  ])
})

test('resource form accepts Vue numeric input values and persists optional weights', async () => {
  const { readGenerationDraft } = await import('./generationInfoDraft.ts')
  for (const [input, expected] of [
    [0.8, 0.8],
    [0, 0],
    ['0.8', 0.8],
    ['', undefined],
    ['  ', undefined],
    [-0.5, -0.5]
  ]) {
    const weight = parseResourceWeight(input)
    assert.equal(weight, expected)
    const raw = appendGenerationResource('portrait', {
      type: 'lora',
      name: 'AAA',
      ...(weight != null ? { weight } : {})
    })
    const resources = JSON.parse(readGenerationDraft(raw).extra).resources
    assert.equal(resources[0].weight, expected)
    if (expected === undefined) assert.equal(Object.hasOwn(resources[0], 'weight'), false)
  }
  for (const invalid of ['bad', NaN, Infinity])
    assert.throws(() => parseResourceWeight(invalid), /有效数字/)
})
