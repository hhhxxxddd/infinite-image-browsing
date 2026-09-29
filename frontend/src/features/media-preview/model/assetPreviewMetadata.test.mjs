import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadAssetPreviewMetadata } from './assetPreviewMetadata.ts'

const artifactMetadata = {
  generation_info: 'submitted prompt',
  embedded_generation_info: 'embedded prompt',
  description: '海滩',
  inferred_prompt: '参考提示词',
  exif: { 像素尺寸: '1024 × 1024' },
  source_image_available: true
}

test('workspace products use artifact metadata consistently, preserving submitted and embedded info', async () => {
  const calls = []
  const data = await loadAssetPreviewMetadata(
    { fullpath: 'workspace-artifact:1', workspace_artifact_id: '1' },
    'image',
    {
      artifact: async (id) => {
        calls.push(id)
        return artifactMetadata
      },
      library: () => assert.fail('must not read a virtual artifact path as a library file')
    }
  )
  assert.deepEqual(calls, ['1'])
  assert.equal(data.generationInfo, 'submitted prompt')
  assert.equal(data.embeddedGenerationInfo, 'embedded prompt')
  assert.equal(data.sourceImageAvailable, true)
  assert.equal(data.description, '海滩')
})

test('library preview and prompt borrowing share the same generation information', async () => {
  const data = await loadAssetPreviewMetadata({ fullpath: 'C:/media/photo.png' }, 'image', {
    artifact: () => assert.fail('library files have no artifact metadata'),
    library: async (path) => {
      assert.equal(path, 'C:/media/photo.png')
      return {
        generationInfo: 'library prompt',
        embeddedGenerationInfo: '',
        description: '已保存的描述',
        inferredPrompt: '独立参考提示词',
        exif: { 格式: 'PNG' },
        sourceImageAvailable: false
      }
    }
  })
  assert.equal(data.generationInfo, 'library prompt')
  assert.equal(data.sourceImageAvailable, false)
  assert.equal(data.description, '已保存的描述')
  assert.equal(data.inferredPrompt, '独立参考提示词')
  assert.deepEqual(data.exif, { 格式: 'PNG' })
})

test('cloud-only files, uploads and edit snapshots do not read local metadata', async () => {
  const loaders = {
    artifact: () => assert.fail('unexpected artifact read'),
    library: () => assert.fail('unexpected library read')
  }
  for (const [file, kind] of [
    [undefined, 'image'],
    [{ fullpath: 'C:/media/online.png', cloud_only: true }, 'image'],
    [{ fullpath: 'C:/media/photo.png', edit_snapshot: {} }, 'image']
  ])
    assert.equal(await loadAssetPreviewMetadata(file, kind, loaders), undefined)
})

test('audio products expose saved metadata, while library audio and video use their own media kind', async () => {
  const audio = await loadAssetPreviewMetadata({ workspace_artifact_id: 'audio-1' }, 'audio', {
    artifact: async () => artifactMetadata,
    library: () => assert.fail('audio product must use the artifact API')
  })
  assert.equal(audio.description, '海滩')
  assert.equal(audio.sourceImageAvailable, false)
  for (const kind of ['audio', 'video']) {
    const metadata = { ...audio, description: kind }
    assert.equal(
      await loadAssetPreviewMetadata({ fullpath: '/media/file' }, kind, {
        library: async (path, mediaKind) => {
          assert.equal(path, '/media/file')
          assert.equal(mediaKind, kind)
          return metadata
        }
      }),
      metadata
    )
  }
})

test('saved input snapshots do not expose product source comparison', async () => {
  const data = await loadAssetPreviewMetadata(
    { workspace_artifact_id: 'input-1', workspace_input_owner: 'draft-1' },
    'image',
    { artifact: async () => artifactMetadata }
  )
  assert.equal(data.sourceImageAvailable, false)
})

test('metadata errors propagate so every entry can show the same retry state', async () => {
  await assert.rejects(
    loadAssetPreviewMetadata({ fullpath: 'C:/media/photo.png' }, 'image', {
      library: async () => {
        throw new Error('unavailable')
      }
    }),
    /unavailable/
  )
})
