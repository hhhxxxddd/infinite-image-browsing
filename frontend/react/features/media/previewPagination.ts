export function nextIndexAfterPage<T extends { fullpath: string }>(
  files: readonly T[],
  currentPath: string
): number | null {
  const currentIndex = files.findIndex((file) => file.fullpath === currentPath)
  return currentIndex >= 0 && currentIndex < files.length - 1 ? currentIndex + 1 : null
}
