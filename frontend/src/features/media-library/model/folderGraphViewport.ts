import { isWindowsFolderPath } from './folderExpansion.ts'

export const FOLDER_GRAPH_VIEWPORT_KEY = 'omnigallery:folder-graph-viewport:v1'
type ViewportStorage = Pick<Storage, 'getItem' | 'setItem'>
type Position = { left: number; top: number }

function viewportKey(path: string) {
  if (!path) return 'overview'
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  return isWindowsFolderPath(path) ? `win:${normalized.toLowerCase()}` : `posix:${normalized}`
}

export function createFolderGraphViewport(storage?: ViewportStorage) {
  const positions = new Map<string, Position>()
  try {
    const saved = JSON.parse(storage?.getItem(FOLDER_GRAPH_VIEWPORT_KEY) ?? 'null')
    if (saved?.version === 1 && Array.isArray(saved.entries)) {
      for (const entry of saved.entries.slice(-150)) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue
        const [key, position] = entry
        if (
          position &&
          Number.isFinite(position.left) &&
          Number.isFinite(position.top) &&
          position.left >= 0 &&
          position.top >= 0
        )
          positions.set(key, { left: position.left, top: position.top })
      }
    }
  } catch {
    /* Browsing still works when browser storage is unavailable. */
  }
  return {
    get: (path: string) => positions.get(viewportKey(path)),
    set(path: string, position: Position) {
      if (!Number.isFinite(position.left) || !Number.isFinite(position.top)) return
      const key = viewportKey(path)
      const next = { left: Math.max(0, position.left), top: Math.max(0, position.top) }
      const old = positions.get(key)
      if (old?.left === next.left && old.top === next.top) return
      positions.delete(key)
      positions.set(key, next)
      while (positions.size > 150) positions.delete(positions.keys().next().value ?? '')
      try {
        storage?.setItem(
          FOLDER_GRAPH_VIEWPORT_KEY,
          JSON.stringify({ version: 1, entries: [...positions] })
        )
      } catch {
        /* A full or restricted storage must not interrupt navigation. */
      }
    }
  }
}

// Keep the desired position until asynchronous descendant rows have loaded.
// User scrolling always takes precedence over a pending restoration.
export function rememberFolderGraphScroll(
  host: HTMLElement,
  content: HTMLElement,
  path: string,
  viewport: ReturnType<typeof createFolderGraphViewport>
) {
  let pending = viewport.get(path)
  let timer: ReturnType<typeof setTimeout> | undefined
  const persist = () => {
    clearTimeout(timer)
    viewport.set(path, pending ?? { left: host.scrollLeft, top: host.scrollTop })
  }
  const restore = () => {
    if (!pending) return
    const left = Math.min(pending.left, Math.max(0, host.scrollWidth - host.clientWidth))
    const top = Math.min(pending.top, Math.max(0, host.scrollHeight - host.clientHeight))
    host.scrollLeft = left
    host.scrollTop = top
    if (Math.abs(left - pending.left) < 1 && Math.abs(top - pending.top) < 1) pending = undefined
  }
  const scroll = () => {
    if (pending) return
    clearTimeout(timer)
    timer = setTimeout(persist, 150)
  }
  const interact = () => {
    pending = undefined
  }
  const keyboard = (event: KeyboardEvent) => {
    if (
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'PageUp',
        'PageDown',
        'Home',
        'End',
        ' '
      ].includes(event.key)
    )
      interact()
  }
  restore()
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(restore)
  observer?.observe(content)
  observer?.observe(host)
  host.addEventListener('scroll', scroll, { passive: true })
  host.addEventListener('wheel', interact, { passive: true })
  host.addEventListener('touchstart', interact, { passive: true })
  host.addEventListener('pointerdown', interact, { passive: true })
  host.addEventListener('keydown', keyboard)
  window.addEventListener('pagehide', persist)
  return () => {
    persist()
    observer?.disconnect()
    host.removeEventListener('scroll', scroll)
    host.removeEventListener('wheel', interact)
    host.removeEventListener('touchstart', interact)
    host.removeEventListener('pointerdown', interact)
    host.removeEventListener('keydown', keyboard)
    window.removeEventListener('pagehide', persist)
  }
}

function browserStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}
export const folderGraphViewport = createFolderGraphViewport(browserStorage())
