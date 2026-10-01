import type { MediaTag } from './mediaApi'

/** Search labels, stored names and whole groups without changing the selection. */
export function filterMediaTags(
  tags: MediaTag[],
  query: string,
  getLabel: (tag: MediaTag) => string = (tag) => tag.display_name || tag.name
): MediaTag[] {
  const search = query.trim().toLocaleLowerCase()
  if (!search) return tags
  return tags.filter((tag) =>
    [getLabel(tag), tag.name, tag.display_name || '', tag.group_name || ''].some((value) =>
      value.toLocaleLowerCase().includes(search)
    )
  )
}
