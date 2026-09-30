import { invoke, isTauri } from '@tauri-apps/api/core'
import cookie from 'js-cookie'
import { sha256Hex } from '../../src/shared/lib/sha256'
import { setRuntimeApiBase } from '../../src/shared/lib/runtimeApiBase'

type AuthKeyPrompt = () => Promise<string>

let baseUrl = '/api'
let initializePromise: Promise<void> | undefined
let authKeyPrompt: AuthKeyPrompt | undefined
let pendingAuthPrompt: Promise<string> | undefined

/** Initialize before rendering URLs for media served by the bundled desktop backend. */
export function initializeApiClient(): Promise<void> {
  if (!isTauri()) return Promise.resolve()
  initializePromise ??= invoke<{ port: number }>('get_tauri_conf').then((config) => {
    baseUrl = `http://127.0.0.1:${config.port}/api`
    setRuntimeApiBase(baseUrl)
  })
  return initializePromise
}

export function apiUrl(path: string): string {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

/** The app shell supplies a Mantine dialog; requests share one prompt on simultaneous 401s. */
export function setAuthKeyPrompt(prompt: AuthKeyPrompt | undefined): void {
  authKeyPrompt = prompt
}

async function errorDetail(
  response: Response
): Promise<{ message: string; secretRejected: boolean }> {
  let detail: unknown
  try {
    const body = await response.clone().json()
    detail = body?.detail
  } catch {
    // Some media endpoints return plain text on failure.
  }
  const secretRejected =
    !!detail &&
    typeof detail === 'object' &&
    'type' in detail &&
    detail.type === 'secret_verification_failed'
  const message =
    typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && 'message' in detail
        ? String(detail.message)
        : `请求失败（${response.status}）`
  return { message, secretRejected }
}

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  await initializeApiClient()
  const headers = new Headers(init.headers)
  if (typeof init.body === 'string' && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json')
  const response = await fetch(apiUrl(path), { credentials: 'include', ...init, headers })
  if (response.ok) return response

  const detail = await errorDetail(response)
  if (response.status === 401 && detail.secretRejected && authKeyPrompt) {
    pendingAuthPrompt ??= authKeyPrompt().finally(() => {
      pendingAuthPrompt = undefined
    })
    const key = await pendingAuthPrompt
    if (key) {
      cookie.set('OMNIGALLERY_SECRET', sha256Hex(`${key}_ciallo`))
      window.location.reload()
      return new Promise<Response>(() => {})
    }
  }
  throw new Error(detail.message)
}

/** Fetch a JSON API response. Use apiRequest for downloads or other binary responses. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiRequest(path, init)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
