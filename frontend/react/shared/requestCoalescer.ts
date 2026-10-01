/** Share concurrent reads only; settled requests never become a stale data cache. */
export function createRequestCoalescer() {
  const pending = new Map<string, Promise<unknown>>()
  return {
    read<T>(key: string, request: () => Promise<T>): Promise<T> {
      const existing = pending.get(key)
      if (existing) return existing as Promise<T>
      const promise = Promise.resolve()
        .then(request)
        .finally(() => {
          // An invalidation may already have started a newer request for this key.
          if (pending.get(key) === promise) pending.delete(key)
        })
      pending.set(key, promise)
      return promise
    },
    forget(key: string) {
      pending.delete(key)
    }
  }
}
