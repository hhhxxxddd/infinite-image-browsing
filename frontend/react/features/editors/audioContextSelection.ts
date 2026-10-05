export type AudioSelection = {
  kind: 'clip' | 'cue' | 'track' | 'marker'
  id: string
} | null

/** A menu on the current selection must not replace a multi-selection or its primary item. */
export function audioContextSelection(
  primary: AudioSelection,
  items: string[],
  expanded: string[],
  target: 'clip' | 'track' | 'blank' | 'text-cue' | 'text-track',
  id?: string
): { primary: AudioSelection; items: string[] } {
  if (!id) return { primary: null, items: [] }
  if (target === 'clip' || target === 'text-cue') {
    if (expanded.includes(id)) return { primary, items }
    return { primary: { kind: target === 'clip' ? 'clip' : 'cue', id }, items: [id] }
  }
  return { primary: { kind: 'track', id }, items: [] }
}
