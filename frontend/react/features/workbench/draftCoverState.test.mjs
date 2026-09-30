import assert from 'node:assert/strict'
import { test } from 'node:test'
import { draftCoverFallback } from './draftCoverState.ts'
import { readAIDraftCover } from './draftCoverState.ts'
import {
  createImageLayer,
  createStudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel.ts'

test('an AI branch awaiting intersection or image decode is never described as missing its main image', () => {
  const mainPath = 'workspace-artifact:4d39ecc8-e121-4313-8bdb-824fb371b8fd'
  assert.equal(
    draftCoverFallback({ kind: 'ai', generation: false, loaded: false, mainPath: '' }),
    '正在读取制作封面…'
  )
  assert.equal(
    draftCoverFallback({ kind: 'ai', generation: false, loaded: true, mainPath }),
    '封面暂不可用'
  )
  assert.equal(
    draftCoverFallback({ kind: 'ai', generation: false, loaded: true, mainPath: '' }),
    '尚未设置主图'
  )
})

test('AI audio tab state cannot replace the saved image cover document or its references', () => {
  const mainPath = 'workspace-artifact:4d39ecc8-e121-4313-8bdb-824fb371b8fd'
  const suffix = 'workspace:work:branch2'
  const document = createStudioDocument('画面与文字')
  document.width = 702
  document.height = 702
  document.layers = [
    createImageLayer(mainPath, { x: 0, y: 0, width: 702, height: 702 }, '分组快照')
  ]
  const entries = new Map([
    [`omnigallery:ai-image-edit-asset-v1:${suffix}`, mainPath],
    [
      `omnigallery:ai-image-edit-v1:${suffix}:${encodeURIComponent(mainPath)}`,
      JSON.stringify(document)
    ],
    [
      `omnigallery:ai-image-refs-v1:${suffix}:${encodeURIComponent(mainPath)}`,
      JSON.stringify(['/ref.png', '/ref.png'])
    ],
    [
      'omnigallery:ai-production-session-v1:workspace:work:branch2',
      JSON.stringify({ version: 1, section: 'audio', imageTask: 'edit' })
    ]
  ])
  const storage = { getItem: (key) => entries.get(key) ?? null }

  const cover = readAIDraftCover(storage, 'workspace', 'work', 'branch2')
  assert.equal(cover.mainPath, mainPath)
  assert.equal(cover.document?.width, 702)
  assert.equal(cover.document?.layers[0].path, mainPath)
  assert.equal(cover.referenceCount, 1)
})

test('a damaged edit document still reports the saved main image identity', () => {
  const suffix = 'workspace:work:branch'
  const mainPath = 'workspace-artifact:main'
  const entries = new Map([
    [`omnigallery:ai-image-edit-asset-v1:${suffix}`, mainPath],
    [`omnigallery:ai-image-edit-v1:${suffix}:${encodeURIComponent(mainPath)}`, '{invalid']
  ])
  const cover = readAIDraftCover(
    { getItem: (key) => entries.get(key) ?? null },
    'workspace',
    'work',
    'branch'
  )
  assert.equal(cover.mainPath, mainPath)
  assert.equal(cover.document, null)
  assert.equal(
    draftCoverFallback({ kind: 'ai', generation: false, loaded: true, mainPath: cover.mainPath }),
    '封面暂不可用'
  )
})
