export interface WorkspaceStateSnapshot {
  revision: number
  imported: boolean
  entries: Record<string, string>
}
export interface WorkspaceStateTransport {
  load(): Promise<WorkspaceStateSnapshot>
  import(entries: Record<string, string>): Promise<WorkspaceStateSnapshot>
  save(revision: number, changes: Record<string, string | null>): Promise<{ revision: number }>
  remove(): Promise<void>
}
export const workspaceStatePrefixes = [
  'audio-timeline-v1',
  'video-timeline-v1',
  'video-export-pending-v1',
  'audio-export-pending-v1',
  'audio-loudness-reports-v1',
  'editor-versions-v1',
  'editor-presets-v1',
  'editor-recovery-v1',
  'workspace-works-v2',
  'workspace-works-v1',
  'workbench-image-documents-v2',
  'workbench-image-document-v2',
  'ai-image-edit-v1',
  'ai-image-edit-asset-v1',
  'ai-image-edit-recent-v1',
  'ai-image-refs-v1',
  'ai-image-ref-v1',
  'ai-production-session-v1',
  'ai-production-active-purpose-v1',
  'ai-production-choice-v1',
  'ai-production-parameters-v1',
  'ai-production-prompt-v1',
  'ai-production-negative-v1',
  'ai-production-generation-choice-v1',
  'ai-production-generation-parameters-v1',
  'ai-production-generation-prompt-v1',
  'ai-production-generation-negative-v1',
  'image-studio-recent-v1',
  'studio-production-choice-v1',
  'studio-production-prompt-v1',
  'studio-production-negative-v1'
] as const

/** Exact workspace boundaries prevent a similarly named workspace from being migrated. */
export function collectBrowserWorkspaceState(workspaceId: string, storage: Storage) {
  const prefixes = workspaceStatePrefixes.map((kind) => `omnigallery:${kind}:${workspaceId}`)
  const entries: Record<string, string> = {}
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key || !prefixes.some((prefix) => key === prefix || key.startsWith(prefix + ':'))) continue
    const value = storage.getItem(key)
    if (value !== null) entries[key] = value
  }
  // Older canvas AI prompts were keyed only by document ID.
  const documentIds = Object.keys(entries)
    .filter((key) => key.startsWith(`omnigallery:workbench-image-document-v2:${workspaceId}:`))
    .flatMap((key) => key.split(':').slice(-1))
  for (const id of documentIds) {
    for (const kind of ['prompt', 'negative'] as const) {
      const oldKey = `omnigallery:studio-comfy-${kind === 'negative' ? 'negative-prompt' : 'prompt'}-v1:${id}`
      const value = storage.getItem(oldKey)
      if (value !== null)
        entries[`omnigallery:studio-production-${kind}-v1:${workspaceId}:${id}`] = value
    }
  }
  return entries
}

export function mapStorage(entries: Map<string, string>, writable = true): Storage {
  const assertWritable = () => {
    if (!writable) throw new Error('请在工作区事务中保存草稿')
  }
  return {
    get length() {
      return entries.size
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem(key, value) {
      assertWritable()
      entries.set(key, value)
    },
    removeItem(key) {
      assertWritable()
      entries.delete(key)
    },
    clear() {
      assertWritable()
      entries.clear()
    }
  }
}

/** The cache is read-only outside a transaction. A failed request never publishes staged changes. */
export class WorkspaceStateStore {
  private entries = new Map<string, string>()
  private revision = 0
  private loaded = false
  private imported = false
  private closed = false
  private loading?: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private transport: WorkspaceStateTransport
  private changed: () => void
  constructor(transport: WorkspaceStateTransport, changed: () => void = () => {}) {
    this.transport = transport
    this.changed = changed
  }
  get storage(): Storage {
    if (!this.loaded || this.closed) throw new Error('工作区草稿尚未读取')
    return mapStorage(this.entries, false)
  }
  async load(browserEntries: () => Record<string, string> = () => ({}), writable = true) {
    if (this.loading) return this.loading
    this.loading = this.queue
      .then(async () => {
        let snapshot = await this.transport.load()
        if (!snapshot.imported && writable) snapshot = await this.transport.import(browserEntries())
        this.entries = new Map(Object.entries(snapshot.entries))
        this.revision = snapshot.revision
        this.imported = snapshot.imported
        this.loaded = true
        this.closed = false
        this.changed()
      })
      .finally(() => {
        this.loading = undefined
      })
    this.queue = this.loading.catch(() => {})
    return this.loading
  }
  async ensure(browserEntries: () => Record<string, string>, writable = true) {
    if (!this.loaded || (!this.imported && writable)) await this.load(browserEntries, writable)
  }
  transaction<T>(operation: (storage: Storage) => T): Promise<T> {
    const run = this.queue.then(async () => {
      if (!this.loaded || this.closed) throw new Error('工作区草稿尚未读取或已删除')
      const staged = new Map(this.entries)
      const result = operation(mapStorage(staged))
      const changes: Record<string, string | null> = {}
      for (const key of new Set([...this.entries.keys(), ...staged.keys()])) {
        const before = this.entries.get(key) ?? null,
          after = staged.get(key) ?? null
        if (before !== after) changes[key] = after
      }
      if (Object.keys(changes).length) {
        let saved: { revision: number }
        try {
          saved = await this.transport.save(this.revision, changes)
        } catch (error) {
          // Refresh committed data for an explicit retry, never replay an uncertain write.
          try {
            const current = await this.transport.load()
            this.revision = current.revision
            this.imported = current.imported
            this.entries = new Map(Object.entries(current.entries))
            this.changed()
          } catch {
            /* Preserve the last confirmed cache while offline. */
          }
          throw error
        }
        this.revision = saved.revision
        this.imported = true
        this.entries = staged
        this.changed()
      }
      return result
    })
    this.queue = run.catch(() => {})
    return run
  }
  remove(): Promise<void> {
    const run = this.queue.then(async () => {
      await this.transport.remove()
      this.closed = true
      this.entries.clear()
      this.changed()
    })
    this.queue = run.catch(() => {})
    return run
  }
}
