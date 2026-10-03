import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeRuntimeApiUrl, setRuntimeApiBase } from './runtimeApiBase.ts'
import { toImageUrl, toImageThumbnailUrl, toRawFileUrl } from './mediaUrls.ts'

test('desktop credentials reach original, thumbnail, artifact and snapshot media URLs', () => {
  setRuntimeApiBase('http://127.0.0.1:9000/api', 'session-token')
  try {
    const original = { fullpath: '/photo.png', name: 'photo.png', date: 'now' }
    const artifact = { ...original, workspace_artifact_id: 'output' }
    const snapshot = {
      ...original,
      edit_snapshot: { owner: '/photo.png', revision: 'revision', asset: 'asset' }
    }
    for (const file of [original, artifact, snapshot]) {
      for (const createUrl of [toImageUrl, toImageThumbnailUrl, toRawFileUrl]) {
        const url = new URL(createUrl(file))
        assert.equal(url.origin, 'http://127.0.0.1:9000')
        assert.equal(url.searchParams.get('desktop_token'), 'session-token')
      }
    }
    assert.equal(
      authorizeRuntimeApiUrl('http://127.0.0.1:9000/api/file#anchor'),
      'http://127.0.0.1:9000/api/file?desktop_token=session-token#anchor'
    )
  } finally {
    setRuntimeApiBase('/api')
  }
})

test('standalone server URLs remain usable without desktop credentials', () => {
  setRuntimeApiBase('/api')
  assert.equal(authorizeRuntimeApiUrl('/api/file?path=photo.png'), '/api/file?path=photo.png')
  assert.ok(!toRawFileUrl({ fullpath: '/photo.png', name: 'photo.png' }).includes('desktop_token'))
})
