type Media = { fullpath: string }

export function dropAfterCard(pointerY: number, cardTop: number, cardHeight: number): boolean {
  return pointerY >= cardTop + cardHeight / 2
}

// Keep the original file objects so moving cards does not reload their content.
export function applyMediaOrder<T extends Media>(files: readonly T[], paths: readonly string[]): T[] {
  const byPath = new Map(files.map(file => [file.fullpath, file]))
  const ranked = new Set(paths)
  return [
    ...paths.flatMap(path => byPath.has(path) ? [byPath.get(path)!] : []),
    ...files.filter(file => !ranked.has(file.fullpath))
  ]
}

export function moveMediaInList<T extends Media>(files: readonly T[], paths: readonly string[], target: string, after: boolean): T[] {
  const chosen = new Set(paths)
  if (chosen.has(target) || !files.some(file => file.fullpath === target)) return [...files]
  const moving = files.filter(file => chosen.has(file.fullpath))
  const remaining = files.filter(file => !chosen.has(file.fullpath))
  const index = remaining.findIndex(file => file.fullpath === target) + Number(after)
  return [...remaining.slice(0, index), ...moving, ...remaining.slice(index)]
}
