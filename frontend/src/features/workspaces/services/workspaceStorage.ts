import { ref } from 'vue'
import { workspaceStateTransport } from '../api/workspaceState'
import { collectBrowserWorkspaceState, WorkspaceStateStore } from '../model/workspaceStateStore'
import { createPersistentImageDraftRepository } from '../model/persistentImageDraftRepository'
import type { StudioDraftRepository } from '@/features/image-editor/public/document'

const stores = new Map<string, WorkspaceStateStore>()
export const workspaceStorageRevision = ref(0)
const channel =
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('omnigallery:workspace-state')
channel?.addEventListener('message', (event) => {
  const store = stores.get(event.data?.workspaceId)
  if (store) void store.load().catch(() => {})
})
export function workspaceStateStore(workspaceId: string) {
  let store = stores.get(workspaceId)
  if (!store) {
    store = new WorkspaceStateStore(workspaceStateTransport(workspaceId), () => {
      workspaceStorageRevision.value++
    })
    stores.set(workspaceId, store)
  }
  return store
}
export async function ensureWorkspaceStorage(workspaceId: string, readonly = false) {
  await workspaceStateStore(workspaceId).ensure(() => {
    return collectBrowserWorkspaceState(workspaceId, localStorage)
  }, !readonly)
}
export async function reloadWorkspaceStorage(workspaceId: string, readonly = false) {
  await workspaceStateStore(workspaceId).load(
    () => collectBrowserWorkspaceState(workspaceId, localStorage),
    !readonly
  )
}
export const workspaceStorage = (workspaceId: string) => workspaceStateStore(workspaceId).storage
export async function saveWorkspaceState<T>(
  workspaceId: string,
  operation: (storage: Storage) => T
): Promise<T> {
  await ensureWorkspaceStorage(workspaceId)
  const result = await workspaceStateStore(workspaceId).transaction(operation)
  channel?.postMessage({ workspaceId })
  return result
}
export async function deleteWorkspaceState(workspaceId: string) {
  await workspaceStateStore(workspaceId).remove()
  // Remove the superseded browser copy only after server deletion succeeds.
  const entries = collectBrowserWorkspaceState(workspaceId, localStorage)
  Object.keys(entries).forEach((key) => localStorage.removeItem(key))
  channel?.postMessage({ workspaceId })
}
export async function reloadLoadedWorkspaceStorage() {
  await Promise.allSettled([...stores.values()].map((store) => store.load()))
}
export function persistentImageDraftRepository(
  workspaceId: string,
  workId?: string
): StudioDraftRepository {
  return createPersistentImageDraftRepository(
    workspaceId,
    workId,
    () => workspaceStorage(workspaceId),
    (operation) => saveWorkspaceState(workspaceId, operation)
  )
}
