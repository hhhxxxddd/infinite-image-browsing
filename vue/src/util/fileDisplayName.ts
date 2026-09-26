/** Display only; file paths and stored names keep their extension. */
export function fileDisplayName(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}
