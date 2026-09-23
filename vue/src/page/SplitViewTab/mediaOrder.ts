type Media = { fullpath: string }

// Keep the original file objects so moving cards does not reload their content.
export function applyMediaOrder<T extends Media>(files: readonly T[], paths: readonly string[]): T[] {
  const byPath = new Map(files.map(file => [file.fullpath, file]))
  const ranked = new Set(paths)
  return [
    ...paths.flatMap(path => byPath.has(path) ? [byPath.get(path)!] : []),
    ...files.filter(file => !ranked.has(file.fullpath))
  ]
}

export function swapMediaInList<T extends Media>(files: readonly T[], source: string, target: string): T[] {
  const swapped = [...files]
  const sourceIndex = swapped.findIndex(file => file.fullpath === source)
  const targetIndex = swapped.findIndex(file => file.fullpath === target)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return swapped
  ;[swapped[sourceIndex], swapped[targetIndex]] = [swapped[targetIndex], swapped[sourceIndex]]
  return swapped
}
