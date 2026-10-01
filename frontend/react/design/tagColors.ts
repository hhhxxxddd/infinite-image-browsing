export const tagColorPresets = [
  { name: '石墨灰', color: '#59616f' },
  { name: '蓝色', color: '#356cb6' },
  { name: '青蓝', color: '#357d90' },
  { name: '绿色', color: '#28795c' },
  { name: '琥珀', color: '#8c651c' },
  { name: '红色', color: '#b8474e' }
] as const

export const defaultTagColor = tagColorPresets[0].color
export const defaultLikeColor = tagColorPresets[5].color

export function tagColor(tag: { name: string; color?: string }) {
  return tag.color || (tag.name === 'like' ? defaultLikeColor : defaultTagColor)
}
