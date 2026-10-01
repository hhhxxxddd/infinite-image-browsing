import { isFavoriteTag } from './favoriteTag.ts'

export function tagLabel(tag: { name: string; display_name?: string | null }): string {
  return isFavoriteTag(tag) ? tag.name : tag.display_name || tag.name
}
