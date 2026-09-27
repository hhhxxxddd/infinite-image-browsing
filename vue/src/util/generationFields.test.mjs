import test from 'node:test'
import assert from 'node:assert/strict'
import { validateGenerationParameter, generationNumberOptions } from './generationFields.ts'
import { readGenerationDraft, writeGenerationDraft, setParameter } from './generationInfoDraft.ts'

test('size and numeric fields accept zero where meaningful and reject malformed values', () => {
  for (const [key,value] of [['Seed','0'],['Seed','-1'],['Denoising strength','0'],['Denoising strength','1'],['Size','1024x768'],['Size','720 × 1280'],['Steps',''],['Hires steps','0']]) assert.doesNotThrow(() => validateGenerationParameter(key,value))
  for (const [key,value] of [['Steps','0'],['Steps','1.5'],['Size','1024'],['Size','0x768'],['Denoising strength','1.5'],['CFG scale','abc']]) assert.throws(() => validateGenerationParameter(key,value))
})
test('new fields roundtrip even when they are the only parameter', () => {
  for (const key of ['Schedule type','Denoising strength','Hires upscale','Hires steps','VAE','Hires upscaler']) {
    const draft = readGenerationDraft('portrait')
    draft.parameters = setParameter('', key, '1')
    const next = readGenerationDraft(writeGenerationDraft(draft))
    assert.equal(next.positive, 'portrait')
    assert.equal(next.parameters, `${key}: 1`)
  }
})

test('numeric editors use matching boundaries and steps; text fields stay editable as text', () => {
  assert.equal(generationNumberOptions('Sampler'), undefined)
  assert.equal(generationNumberOptions('Schedule type'), undefined)
  assert.equal(generationNumberOptions('Size'), undefined)
  assert.deepEqual(generationNumberOptions('Denoising strength'), {min:0,max:1,integer:false,step:0.05})
  assert.equal(generationNumberOptions('CFG scale').step, 0.1)
  assert.equal(generationNumberOptions('Seed').min, -1)
  assert.equal(generationNumberOptions('Seed').max, Number.MAX_SAFE_INTEGER)
  for (const key of ['Steps','Seed','Clip skip','Hires steps']) {
    assert.equal(generationNumberOptions(key).integer, true)
    assert.equal(generationNumberOptions(key).step, 1)
  }
})
