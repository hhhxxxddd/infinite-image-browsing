import type { MediaFile } from './mediaApi'
import { mediaFileKind } from '../../../src/shared/lib/mediaFormats.ts'

export type DirectoryWalkSort =
  | 'manual'
  | 'date-asc'
  | 'date-desc'
  | 'created-time-asc'
  | 'created-time-desc'
  | 'name-asc'
  | 'name-desc'
  | 'size-asc'
  | 'size-desc'
  | 'shuffle'

export interface DirectoryWalkSnapshot {
  files: MediaFile[]
  hasNext: boolean
  nextDirectoryPath: string | null
  pendingDirectories: number
}

export interface DirectoryWalkPage extends DirectoryWalkSnapshot {
  added: MediaFile[]
  loadedDirectory: string | null
}

export interface DirectoryWalkOptions {
  sort?: DirectoryWalkSort
  /** Defaults to the existing, server-authorized GET /files route. */
  read?: (path: string) => Promise<{ files: MediaFile[] }>
  /** Defaults to the same media type classifier as the library cards. */
  isMedia?: (file: MediaFile) => boolean
}

interface WalkNode {
  path: string
  entries: Array<{ file: MediaFile; child?: WalkNode }>
}

function pathKey(path: string): string {
  const raw = path.replace(/\\/g, '/')
  if (
    !raw ||
    (!raw.startsWith('/') && !/^[a-z]:\//i.test(raw)) ||
    raw.includes('\0') ||
    raw.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('无效的目录路径')
  const normalized = raw.replace(/\/+/g, '/').replace(/\/+$/, '') || '/'
  return /^[a-z]:/i.test(raw) || raw.startsWith('//') ? normalized.toLowerCase() : normalized
}

function isDirectChild(parent: string, child: string): boolean {
  const base = pathKey(parent)
  const target = pathKey(child)
  const prefix = base === '/' ? '/' : `${base}/`
  if (!target.startsWith(prefix)) return false
  const rest = target.slice(prefix.length)
  return !!rest && !rest.includes('/')
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

function sortedChildren(files: MediaFile[], sort: DirectoryWalkSort): MediaFile[] {
  if (sort === 'shuffle') {
    return [
      ...shuffled(files.filter((file) => file.type === 'dir')),
      ...shuffled(files.filter((file) => file.type === 'file'))
    ]
  }
  const compare = (a: MediaFile, b: MediaFile): number => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    if (sort === 'manual') return 0
    if (sort === 'date-asc') return (a.date || '').localeCompare(b.date || '')
    if (sort === 'date-desc') return (b.date || '').localeCompare(a.date || '')
    if (sort === 'created-time-asc')
      return (a.created_time || '').localeCompare(b.created_time || '')
    if (sort === 'created-time-desc')
      return (b.created_time || '').localeCompare(a.created_time || '')
    if (sort === 'name-asc') return a.name.localeCompare(b.name, 'zh')
    if (sort === 'name-desc') return b.name.localeCompare(a.name, 'zh')
    if (sort === 'size-asc') return (a.bytes || 0) - (b.bytes || 0)
    return (b.bytes || 0) - (a.bytes || 0)
  }
  return [...files].sort(compare)
}

/** One loadNext call reads one directory, like the legacy Walker.next cursor. */
export class DirectoryWalker {
  private root: WalkNode
  private pending: WalkNode[]
  private visited = new Set<string>()
  private inFlight?: Promise<DirectoryWalkPage>
  private generation = 0
  private readonly options: DirectoryWalkOptions

  constructor(rootPath: string, options: DirectoryWalkOptions = {}) {
    pathKey(rootPath)
    this.root = { path: rootPath, entries: [] }
    this.pending = [this.root]
    this.options = options
  }

  reset(rootPath = this.root.path): void {
    pathKey(rootPath)
    this.generation += 1
    this.root = { path: rootPath, entries: [] }
    this.pending = [this.root]
    this.visited.clear()
    this.inFlight = undefined
  }

  snapshot(): DirectoryWalkSnapshot {
    const files: MediaFile[] = []
    const seen = new Set<string>()
    const visit = (node: WalkNode) => {
      for (const entry of node.entries) {
        if (entry.child) visit(entry.child)
        else {
          const key = pathKey(entry.file.fullpath)
          if (!seen.has(key)) {
            seen.add(key)
            files.push(entry.file)
          }
        }
      }
    }
    visit(this.root)
    return {
      files,
      hasNext: this.pending.length > 0,
      nextDirectoryPath: this.pending[0]?.path || null,
      pendingDirectories: this.pending.length
    }
  }

  loadNext(): Promise<DirectoryWalkPage> {
    if (this.inFlight) return this.inFlight
    const promise = this.loadOne().finally(() => {
      if (this.inFlight === promise) this.inFlight = undefined
    })
    this.inFlight = promise
    return promise
  }

  private async loadOne(): Promise<DirectoryWalkPage> {
    const generation = this.generation
    while (this.pending.length && this.visited.has(pathKey(this.pending[0].path)))
      this.pending.shift()
    const node = this.pending[0]
    if (!node) return { ...this.snapshot(), added: [], loadedDirectory: null }

    const read =
      this.options.read ||
      (async (path: string) => {
        const { getFolderChildren } = await import('./mediaApi')
        return getFolderChildren(path, false)
      })
    const response = await read(node.path)
    if (generation !== this.generation)
      return { ...this.snapshot(), added: [], loadedDirectory: null }
    if (!response || !Array.isArray(response.files)) throw new Error('目录接口返回无效数据')
    const classify =
      this.options.isMedia || ((file: MediaFile) => mediaFileKind(file.name) !== 'other')
    const children = response.files.filter((file) => {
      if (!file || (file.type !== 'file' && file.type !== 'dir') || !file.fullpath)
        throw new Error('目录接口返回无效文件')
      if (!isDirectChild(node.path, file.fullpath))
        throw new Error('目录接口返回了当前目录之外的路径')
      return file.type === 'dir' || classify(file)
    })
    const nextNodes: WalkNode[] = []
    const added: MediaFile[] = []
    node.entries = sortedChildren(children, this.options.sort || 'created-time-desc').map(
      (file) => {
        if (file.type === 'dir') {
          const child: WalkNode = { path: file.fullpath, entries: [] }
          nextNodes.push(child)
          return { file, child }
        }
        added.push(file)
        return { file }
      }
    )
    this.pending.shift()
    this.visited.add(pathKey(node.path))
    this.pending.unshift(...nextNodes.filter((child) => !this.visited.has(pathKey(child.path))))
    return { ...this.snapshot(), added, loadedDirectory: node.path }
  }
}
