let runtimeApiBase = '/api'
let desktopToken = ''

export function setRuntimeApiBase(value: string, token = ''): void {
  runtimeApiBase = value.replace(/\/$/, '')
  desktopToken = token
}

export function getRuntimeApiBase(): string {
  return runtimeApiBase
}

export function getDesktopApiToken(): string {
  return desktopToken
}

export function authorizeRuntimeApiUrl(url: string): string {
  if (!desktopToken) return url
  const [path, fragment] = url.split('#', 2)
  return `${path}${path.includes('?') ? '&' : '?'}desktop_token=${encodeURIComponent(desktopToken)}${fragment === undefined ? '' : `#${fragment}`}`
}
