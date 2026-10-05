export type ArtifactDeletion = { id: string; path: string }

const listeners = new Set<(event: ArtifactDeletion) => void>()
let deletedIds: ReadonlySet<string> = new Set()
const channel =
  typeof window === 'undefined' || typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('omnigallery:deleted-artifacts')

function receive(id: string) {
  if (!id || deletedIds.has(id)) return
  deletedIds = new Set([...deletedIds, id])
  const event = { id, path: `workspace-artifact:${id}` }
  listeners.forEach((notify) => notify(event))
}

channel?.addEventListener('message', (event) => {
  if (typeof event.data?.id === 'string') receive(event.data.id)
})

/** Hide deleted results even when a tool still owns a stale export or added-material list. */
export function getDeletedArtifactIds(): ReadonlySet<string> {
  return deletedIds
}

export function subscribeArtifactDeletion(listener: (event: ArtifactDeletion) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyArtifactDeleted(id: string) {
  receive(id)
  channel?.postMessage({ id })
}
