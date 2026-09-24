export interface TagGroupView<T> {
  name: string
  tags: T[]
  total: number
}

export function groupTags<T extends { group_name: string }>(tags: T[], groupNames: string[]): TagGroupView<T>[] {
  const names = ['', ...groupNames]
  const byGroup = new Map(names.map(name => [name, [] as T[]]))
  for (const tag of tags) (byGroup.get(tag.group_name || '') ?? byGroup.get('')!).push(tag)
  return names.map(name => {
    const members = byGroup.get(name)!
    return { name, tags: members, total: members.length }
  })
}

export function filterTagGroups<T extends { name: string }>(
  groups: TagGroupView<T>[], query: string, label: (tag: T) => string,
): TagGroupView<T>[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return groups
  return groups.flatMap(group => {
    if (group.name.toLowerCase().includes(needle)) return [group]
    const matches = group.tags.filter(tag => label(tag).toLowerCase().includes(needle) || tag.name.toLowerCase().includes(needle))
    return matches.length ? [{ ...group, tags: matches }] : []
  })
}

export function paginateTags<T>(tags: T[], page: number, pageSize: number): T[] {
  return tags.slice((page - 1) * pageSize, page * pageSize)
}
