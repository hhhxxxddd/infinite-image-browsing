import test from 'node:test'
import assert from 'node:assert/strict'
import { filterTagGroups, groupTags, paginateTags } from './tagListView.ts'

test('search finds labels, original names and whole groups without losing ungrouped tags', () => {
  const tags = [
    { name: 'like', display_name: '喜欢', group_name: '' },
    { name: 'sunset', display_name: '日落', group_name: '风景' },
    { name: 'forest', display_name: '树林', group_name: '风景' },
    { name: 'orphan', display_name: '遗留', group_name: '已删除分组' },
  ]
  const groups = groupTags(tags, ['风景'])
  const label = tag => tag.display_name
  assert.deepEqual(groups.map(group => group.total), [2, 2])
  assert.deepEqual(filterTagGroups(groups, '日落', label).map(group => group.tags[0].name), ['sunset'])
  assert.deepEqual(filterTagGroups(groups, 'sunset', label).map(group => group.tags[0].name), ['sunset'])
  assert.deepEqual(filterTagGroups(groups, '风景', label)[0].tags.map(tag => tag.name), ['sunset', 'forest'])
})

test('large groups display one bounded page while search can reach every tag', () => {
  const tags = Array.from({ length: 10_000 }, (_, index) => ({
    name: `tag-${index}`, group_name: index % 2 ? '人物' : '风景',
  }))
  const groups = groupTags(tags, ['风景', '人物'])
  const page = paginateTags(groups[1].tags, 125, 40)
  assert.equal(page.length, 40)
  assert.equal(page[0].name, 'tag-9920')
  assert.equal(page.at(-1).name, 'tag-9998')
  const matches = filterTagGroups(groups, 'tag-9999', tag => tag.name)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].tags[0].name, 'tag-9999')
})
