import { tagLabel } from './tagLabel'

interface TagGroupMember {
  name: string
  display_name?: string | null
  type: string
  group_name?: string
  count: number
}

export const tagGroupKey = (tag: Pick<TagGroupMember, 'type' | 'group_name'>) =>
  tag.type === 'custom' && tag.group_name ? `custom:${tag.group_name}` : tag.type

export const tagGroupLabel = (key: string) =>
  key.startsWith('custom:') ? key.slice('custom:'.length) : key === 'custom' ? '未分组' : key

export function groupTags<T extends TagGroupMember>(tags: T[]) {
  const groups = new Map<string, T[]>()
  for (const tag of tags) {
    const key = tagGroupKey(tag)
    const members = groups.get(key) ?? []
    members.push(tag)
    groups.set(key, members)
  }
  return [...groups]
    .map(([key, items]) => ({
      key,
      label: tagGroupLabel(key),
      tags: items.sort((a, b) => b.count - a.count || tagLabel(a).localeCompare(tagLabel(b), 'zh'))
    }))
    .sort((a, b) => {
      const aCustom = a.key === 'custom' || a.key.startsWith('custom:')
      const bCustom = b.key === 'custom' || b.key.startsWith('custom:')
      return aCustom === bCustom ? a.label.localeCompare(b.label, 'zh') : aCustom ? -1 : 1
    })
}
