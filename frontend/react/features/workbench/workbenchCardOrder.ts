export const workbenchSortOptions = [
  { value: 'recent', label: '最近使用' },
  { value: 'created-desc', label: '创建日期：新到旧' },
  { value: 'created-asc', label: '创建日期：旧到新' },
  { value: 'updated-desc', label: '更新日期：新到旧' },
  { value: 'updated-asc', label: '更新日期：旧到新' }
] as const

export type WorkbenchSort = (typeof workbenchSortOptions)[number]['value']

export interface WorkbenchDatedCard {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
  drafts?: readonly { updatedAt: string }[]
}

export function readWorkbenchSort(value: unknown): WorkbenchSort {
  return workbenchSortOptions.find((option) => option.value === value)?.value ?? 'recent'
}

function timestamp(value?: string) {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

export function workbenchCardDate(item: WorkbenchDatedCard, order: WorkbenchSort) {
  const created = timestamp(item.createdAt)
  if (order.startsWith('created') && created !== undefined)
    return { label: '创建', timestamp: created }
  const opened = timestamp(item.lastOpenedAt)
  if (order === 'recent' && opened !== undefined) return { label: '使用', timestamp: opened }
  let updated = timestamp(item.updatedAt)
  for (const draft of item.drafts ?? []) {
    const date = timestamp(draft.updatedAt)
    if (date !== undefined) updated = updated === undefined ? date : Math.max(updated, date)
  }
  if (order.startsWith('created')) return { label: '创建', timestamp: updated }
  return { label: '更新', timestamp: updated ?? created }
}

export function sortWorkbenchCards<T extends WorkbenchDatedCard>(
  items: readonly T[],
  order: WorkbenchSort
): T[] {
  const direction = order.endsWith('asc') ? 1 : -1
  return items
    .map((item) => ({ item, date: workbenchCardDate(item, order).timestamp }))
    .sort((left, right) => {
      if (left.date === undefined && right.date !== undefined) return 1
      if (right.date === undefined && left.date !== undefined) return -1
      return (
        ((left.date ?? 0) - (right.date ?? 0)) * direction ||
        left.item.name.localeCompare(right.item.name, 'zh-CN', { numeric: true }) ||
        left.item.id.localeCompare(right.item.id)
      )
    })
    .map(({ item }) => item)
}
