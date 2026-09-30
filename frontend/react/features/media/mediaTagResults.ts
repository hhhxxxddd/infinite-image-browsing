/** The backend omits files with no tags; callers merge this map into cached state. */
export function completeMediaTagResults<T>(
  requestedPaths: readonly string[],
  response: Record<string, T[]>
): Record<string, T[]> {
  return Object.fromEntries(
    requestedPaths.map((path) => [path, Array.isArray(response[path]) ? response[path] : []])
  )
}
