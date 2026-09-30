/** Serializes draft writes and keeps flushing until the latest edit is durable. */
export class EditorSaveQueue<T> {
  private current: T
  private readonly write: (snapshot: T) => Promise<void>
  private revision = 0
  private savedRevision = 0
  private inFlight: Promise<void> | null = null

  constructor(initial: T, write: (snapshot: T) => Promise<void>) {
    this.current = initial
    this.write = write
  }

  get dirty(): boolean {
    return this.savedRevision < this.revision
  }

  update(value: T): void {
    if (value === this.current) return
    this.current = value
    this.revision += 1
  }

  async flush(): Promise<T> {
    while (this.dirty) {
      if (!this.inFlight) {
        const revision = this.revision
        const snapshot = structuredClone(this.current)
        const task = Promise.resolve()
          .then(() => this.write(snapshot))
          .then(() => {
            this.savedRevision = revision
          })
        const settled = task.finally(() => {
          if (this.inFlight === settled) this.inFlight = null
        })
        this.inFlight = settled
      }
      await this.inFlight
    }
    return this.current
  }
}
