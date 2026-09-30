let runtimeApiBase = '/api'

export function setRuntimeApiBase(value: string): void {
  runtimeApiBase = value.replace(/\/$/, '')
}

export function getRuntimeApiBase(): string {
  return runtimeApiBase
}
