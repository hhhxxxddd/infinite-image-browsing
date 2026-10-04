import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultCreationModels,
  normalizeRouterChoice,
  routerImageSizes,
  routerReferenceLimit
} from './creationOptions.ts'

test('latest curated models and switching model options', () => {
  assert.equal(defaultCreationModels.length, 9)
  assert.deepEqual(
    defaultCreationModels.filter((m) => m.id.startsWith('bfl/')).map((m) => m.id),
    ['bfl/flux-3-image']
  )
  assert.deepEqual(
    normalizeRouterChoice({
      model: 'openai/gpt-image-2.5-flare',
      aspectRatio: '16:9',
      imageSize: '4K'
    }),
    { model: 'openai/gpt-image-2.5-flare', aspectRatio: 'auto', imageSize: '1K' }
  )
  assert.equal(
    normalizeRouterChoice({ model: 'bfl/flux-2-pro', aspectRatio: '1:1', imageSize: '2K' }).model,
    'bfl/flux-3-image'
  )
  assert.deepEqual(routerImageSizes('byteplus/seedream-5-0-260128'), ['2K', '3K'])
  assert.equal(routerReferenceLimit('bfl/flux-3-image'), 9)
  assert.equal(routerReferenceLimit('byteplus/seedream-5-0-pro-260628'), 9)
})
