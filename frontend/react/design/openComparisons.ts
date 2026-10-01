import type { ComparisonFile } from '../features/comparison/ComparisonPage'

export interface OpenComparison {
  id: string
  name: string
  left: ComparisonFile
  right: ComparisonFile
}

const reactStorageKey = 'omnigallery:react-open-comparisons:v1'
const legacyStorageKey = 'omnigallery:tab-layout:v1'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function file(value: unknown): ComparisonFile | null {
  if (!record(value) || typeof value.fullpath !== 'string' || !value.fullpath) return null
  return {
    fullpath: value.fullpath,
    name:
      typeof value.name === 'string' && value.name
        ? value.name
        : value.fullpath.split(/[\\/]/).pop() || value.fullpath
  }
}

export function comparisonId(left: ComparisonFile, right: ComparisonFile): string {
  return `${left.fullpath}\u0000${right.fullpath}`
}

function parseComparisons(raw: string | null, legacy = false): OpenComparison[] | null {
  if (!raw) return null
  try {
    const saved: unknown = JSON.parse(raw)
    if (!record(saved) || saved.version !== 1) return null
    const source = legacy ? saved.tabs : saved.comparisons
    if (!Array.isArray(source)) return null
    const seen = new Set<string>()
    const panes = legacy
      ? source.flatMap((tab: unknown) => (record(tab) && Array.isArray(tab.panes) ? tab.panes : []))
      : source
    return panes.flatMap((pane: unknown): OpenComparison[] => {
      if (!record(pane) || (legacy && pane.type !== 'img-sli')) return []
      const left = file(pane.left)
      const right = file(pane.right)
      if (!left || !right) return []
      const id = comparisonId(left, right)
      if (seen.has(id)) return []
      seen.add(id)
      return [
        {
          id,
          name:
            typeof pane.name === 'string' && pane.name ? pane.name : `${left.name} ↔ ${right.name}`,
          left,
          right
        }
      ]
    })
  } catch {
    return null
  }
}

export function readOpenComparisons(): OpenComparison[] {
  try {
    return (
      parseComparisons(localStorage.getItem(reactStorageKey)) ??
      parseComparisons(localStorage.getItem(legacyStorageKey), true) ??
      []
    )
  } catch {
    return []
  }
}

export function saveOpenComparisons(comparisons: OpenComparison[]): void {
  try {
    localStorage.setItem(reactStorageKey, JSON.stringify({ version: 1, comparisons }))
  } catch {
    // Comparison links continue to work without storage.
  }
}

export function addOpenComparison(
  comparisons: OpenComparison[],
  left: ComparisonFile,
  right: ComparisonFile
): OpenComparison[] {
  const id = comparisonId(left, right)
  return comparisons.some((comparison) => comparison.id === id)
    ? comparisons
    : [...comparisons, { id, name: `${left.name} ↔ ${right.name}`, left, right }]
}
