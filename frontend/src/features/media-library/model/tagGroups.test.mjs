import assert from 'node:assert/strict'
import test from 'node:test'
import { groupTags } from './tagGroups.ts'
import { favoriteTagFirst, isFavoriteTag } from './favoriteTag.ts'
import { tagLabel } from './tagLabel.ts'

const tag = (id, group_name, count = 0, type = 'custom') => ({
  id,
  name: `tag-${id}`,
  group_name,
  count,
  type
})

test('ungrouped tags precede named groups regardless of input order or group popularity', () => {
  const tags = [
    tag(1, '风景', 100),
    tag(2, '', 50, 'Model'),
    tag(3, '人物', 80),
    tag(4, '', 2),
    tag(5, undefined, 5)
  ]
  const snapshot = structuredClone(tags)
  const groups = groupTags(tags)
  assert.deepEqual(
    groups.map((group) => group.key),
    ['custom', 'custom:风景', 'custom:人物', 'Model']
  )
  assert.equal(groups[0].label, '未分组')
  assert.deepEqual(
    groups[0].tags.map((tag) => tag.id),
    [5, 4]
  )
  assert.equal(groups[0].tags[0], tags[4])
  assert.deepEqual(tags, snapshot)
})

test('a bounded menu includes ungrouped tags even when they follow fifty named tags', () => {
  const tags = [
    ...Array.from({ length: 60 }, (_, index) => tag(index, '人物', 100)),
    tag(60, '', 0)
  ]
  const groups = groupTags(tags, 50)
  assert.equal(groups[0].key, 'custom')
  assert.equal(groups[0].tags[0], tags[60])
  assert.equal(
    groups.reduce((count, group) => count + group.tags.length, 0),
    50
  )
  assert.equal(
    groupTags(tags).reduce((count, group) => count + group.tags.length, 0),
    61
  )
  assert.deepEqual(groupTags([]), [])
})

test('the built-in favorite leads its group and bounded menus even with zero usage', () => {
  const favorite = { ...tag(99, '', 0), name: '喜欢', display_name: 'like' }
  const ordinary = Array.from({ length: 60 }, (_, index) => tag(index, '', 100))
  const tags = [...ordinary, favorite]
  assert.equal(groupTags(tags, 1)[0].tags[0], favorite)
  assert.deepEqual(tags.slice().sort(favoriteTagFirst), [favorite, ...ordinary])
  assert.equal(tagLabel(favorite), '喜欢')
  assert.equal(isFavoriteTag({ ...favorite, type: 'pos' }), false)
  assert.equal(isFavoriteTag({ name: 'like', type: 'custom' }), false)
})
