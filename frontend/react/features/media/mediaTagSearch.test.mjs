import assert from 'node:assert/strict'
import test from 'node:test'
import { filterMediaTags } from './mediaTagSearch.ts'

const tags = [
  { id: 1, name: 'sunset', display_name: '日落', group_name: '风景' },
  { id: 2, name: 'forest', display_name: '树林', group_name: '风景' },
  { id: 3, name: 'like', display_name: null, group_name: '' },
  { id: 4, name: 'sunset-copy', display_name: '日落', group_name: '收藏候选' }
]

test('tag search finds an entire group and preserves original tag identities', () => {
  const snapshot = structuredClone(tags)
  const results = filterMediaTags(tags, ' 风景 ')
  assert.deepEqual(
    results.map((tag) => tag.id),
    [1, 2]
  )
  assert.equal(results[0], tags[0])
  assert.deepEqual(tags, snapshot)
})

test('tag search supports stored names, translated labels and duplicate visible names', () => {
  assert.deepEqual(
    filterMediaTags(tags, 'SUNSET').map((tag) => tag.id),
    [1, 4]
  )
  assert.deepEqual(
    filterMediaTags(tags, '日落').map((tag) => tag.id),
    [1, 4]
  )
  assert.deepEqual(
    filterMediaTags(tags, '喜欢', (tag) => (tag.name === 'like' ? '喜欢' : tag.name)).map(
      (tag) => tag.id
    ),
    [3]
  )
  assert.equal(filterMediaTags(tags, '   '), tags)
  assert.deepEqual(filterMediaTags(tags, '不存在'), [])
})
