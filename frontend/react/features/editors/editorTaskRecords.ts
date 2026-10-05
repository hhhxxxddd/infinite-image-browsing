export type RemovedTaskRecord = { source: string; owner: string; id: string }

/** Successful deletion stays authoritative over older fetches and mounted editor props. */
export class EditorTaskRecords {
  private removed = new Set<string>()
  private listeners = new Set<(record: RemovedTaskRecord) => void>()

  private key(source: string, owner: string, id: string) {
    return JSON.stringify([source, owner, id])
  }

  has(source: string, owner: string, id: string) {
    return this.removed.has(this.key(source, owner, id))
  }

  remove(source: string, owner: string, id: string) {
    const key = this.key(source, owner, id)
    if (this.removed.has(key)) return
    this.removed.add(key)
    for (const listener of this.listeners) listener({ source, owner, id })
  }

  filter<T extends { id: string; deleted?: boolean }>(
    source: string,
    owner: string,
    records: T[]
  ): T[] {
    return records.filter((record) => !record.deleted && !this.has(source, owner, record.id))
  }

  subscribe(listener: (record: RemovedTaskRecord) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/** Server ids are never reused; this in-memory guard also survives closing the floating panel. */
export const editorTaskRecords = new EditorTaskRecords()
