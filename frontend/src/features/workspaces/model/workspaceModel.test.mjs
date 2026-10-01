import assert from 'node:assert/strict'
import test from 'node:test'
import { addWorkspaceAssets, readWorkspaceRecords } from './workspaceModel.ts'
import { readWorkspaceColor } from './workspaceColor.ts'

test('workspace colors normalize opaque hex values and ignore invalid stored data', () => {
  const original = { id: 'workspace', name: '短剧', updatedAt: '2026-09-29T00:00:00Z' }
  for (const [color, expected] of [
    ['#ABC', '#aabbcc'],
    [' #B9D0DE ', '#b9d0de']
  ]) {
    const restored = readWorkspaceRecords(
      JSON.parse(JSON.stringify({ version: 2, items: [{ ...original, color }] }))
    )
    assert.equal(restored[0].color, expected)
  }
  for (const color of [undefined, '', 'silver', '#12345678', 'red', 'url(other)', null, 42]) {
    assert.equal(readWorkspaceColor(color), undefined)
    assert.equal(
      readWorkspaceRecords({ version: 2, items: [{ ...original, color }] })[0].color,
      undefined
    )
  }
})

test('rejects obsolete workspace formats', () => {
  assert.deepEqual(readWorkspaceRecords({ version: 1, items: [{ id: 'old', name: 'old' }] }), [])
})

test('workspace covers and last-opened times survive restoration without changing legacy records', () => {
  const original = { id: 'workspace', name: '短剧', updatedAt: '2026-09-29T00:00:00Z' }
  const read = (fields) =>
    readWorkspaceRecords({ version: 2, items: [{ ...original, ...fields }] })[0]
  assert.equal(read({ cover: 'a'.repeat(64) }).cover, 'a'.repeat(64))
  assert.equal(read({ lastOpenedAt: '2026-09-29T08:00:00Z' }).lastOpenedAt, '2026-09-29T08:00:00Z')
  assert.equal(read({}).cover, undefined)
  assert.equal(read({ cover: '../../other-file', lastOpenedAt: 'bad-date' }).cover, undefined)
  assert.equal(
    read({ cover: 'https://example.com/cover.png', lastOpenedAt: 'bad-date' }).lastOpenedAt,
    undefined
  )
})

test('one workspace keeps source and output references without duplicating assets', () => {
  const file = { id: 4, path: '/media/a.jpg', name: 'a.jpg', kind: 'image' }
  const [workspace] = readWorkspaceRecords({
    version: 2,
    items: [
      {
        id: 'new',
        name: '旅行九宫格',
        brief: '准备社媒发布',
        status: 'active',
        createdAt: '2026-09-24T00:00:00Z',
        updatedAt: '2026-09-24T00:00:00Z',
        lastTool: 'image',
        assets: [file, file],
        outputs: [file],
        notes: { image: '先排版' }
      }
    ]
  })
  assert.equal(workspace.assets.length, 1)
  assert.equal(workspace.outputs.length, 1)
  assert.equal(workspace.lastTool, 'image')
  assert.equal(workspace.notes.image, '先排版')
  assert.equal(addWorkspaceAssets(workspace.assets, [file]).length, 1)
})
