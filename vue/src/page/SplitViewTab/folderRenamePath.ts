export function remapFolderPath(path: string, source: string, destination: string, windows = false): string | undefined {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const from = normalize(source)
  const current = normalize(path)
  const match = windows ? current.toLowerCase() : current
  const prefix = windows ? from.toLowerCase() : from
  if (match !== prefix && !match.startsWith(`${prefix}/`)) return
  const suffix = current.slice(from.length)
  return destination.replace(/[\\/]+$/, '') + (windows ? suffix.replace(/\//g, '\\') : suffix)
}
