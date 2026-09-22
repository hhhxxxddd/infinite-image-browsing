import type { SearchFilters, Tag } from '@/api/db'
import { t } from '@/i18n'

export const emptySearchFilters = (): SearchFilters => ({
  and_tags: [], or_tags: [], not_tags: [], dimensions: {}
})

export function describeSearchFilters(filters: Partial<SearchFilters> | undefined, tags: Tag[] = []) {
  if (!filters) return ''
  const parts: string[] = []
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
  return parts.join(' · ')
}
