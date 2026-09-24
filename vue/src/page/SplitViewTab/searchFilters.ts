import type { SearchFilters, Tag } from '@/api/db'
import { t } from '@/i18n'

const typeNames: Record<string, string> = {
  custom: '未分组', Model: '模型', Sampler: '采样器', lora: 'LoRA', lyco: 'LyCORIS',
  pos: '提示词', Refiner: '精修模型', 'Hires upscaler': '高清放大器',
  'Postprocess upscaler': '后期放大器', 'Postprocess upscale by': '后期放大倍率',
  'Source Identifier': '来源', Size: '生成尺寸'
}
export const filterTagTypeLabel = (type: string) => type.startsWith('custom:')
  ? type.slice('custom:'.length) : typeNames[type] ?? type

export const emptySearchFilters = (): SearchFilters => ({
  and_tags: [], or_tags: [], not_tags: [], exclude_all_tags: false, tag_groups: {}, dimensions: {}
})

export function describeSearchFilters(filters: Partial<SearchFilters> | undefined, tags: Tag[] = []) {
  if (!filters) return ''
  const parts: string[] = []
  if (filters.exclude_all_tags) parts.push('无标签')
  const size = filters.dimensions
  if (size?.width) parts.push(`${size.width} × ${size.height} px`)
  if (size?.ratio_width) parts.push(`${size.ratio_width}:${size.ratio_height}`)
  for (const [key, label] of [['and_tags', 'exactMatch'], ['or_tags', 'anyMatch'], ['not_tags', 'exclude']] as const) {
    const names = filters[key]?.map(id => {
      const tag = tags.find(tag => String(tag.id) === String(id))
      return tag?.display_name || tag?.name || String(id)
    })
    if (names?.length) parts.push(`${t(label)}: ${names.join(', ')}`)
  }
  for (const [type, ids] of Object.entries(filters.tag_groups ?? {})) {
    if (!ids.length) continue
    const names = ids.map(id => {
      const tag = tags.find(tag => String(tag.id) === String(id))
      return tag?.display_name || tag?.name || String(id)
    })
    parts.push(`${filterTagTypeLabel(type)}: ${names.join(', ')}`)
  }
  return parts.join(' · ')
}
