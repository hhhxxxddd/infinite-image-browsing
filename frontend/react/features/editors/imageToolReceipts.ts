/** Session deduplication must not acknowledge edits that have not been saved. */
export class ImageToolReceipts {
  readonly handled = new Set<string>()
  readonly durable = new Set<string>()

  captureSave(): () => string[] {
    const ids = [...this.handled]
    return () => {
      ids.forEach((id) => this.durable.add(id))
      return ids
    }
  }
}
