export const FAVORITE_TAG_NAME = '喜欢'

export function isFavoriteTag(tag: { name: string; type?: string }): boolean {
  return tag.name === FAVORITE_TAG_NAME && (tag.type === undefined || tag.type === 'custom')
}

/** Promote the built-in favorite without changing the relative order of other tags. */
export const favoriteTagFirst = (
  a: { name: string; type?: string },
  b: { name: string; type?: string }
) => Number(isFavoriteTag(b)) - Number(isFavoriteTag(a))
