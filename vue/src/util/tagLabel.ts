export function tagLabel(tag: {name: string; display_name?: string | null}): string {
  return tag.name === 'like' ? '喜欢' : tag.display_name || tag.name
}
