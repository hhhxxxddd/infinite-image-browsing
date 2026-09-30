import {
  collectBrowserWorkspaceState,
  WorkspaceStateStore,
  type WorkspaceStateTransport
} from '../../src/features/workspaces/model/workspaceStateStore'
import { apiFetch } from './apiClient'

const stores = new Map<string, WorkspaceStateStore>()
const listeners = new Map<string, Set<() => void>>()
const channel =
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('omnigallery:workspace-state')

function transport(workspaceId: string): WorkspaceStateTransport {
  const path = `/workspace_state/${encodeURIComponent(workspaceId)}`
  return {
    load: () => apiFetch(path),
    import: (entries) =>
      apiFetch(`${path}/import`, { method: 'POST', body: JSON.stringify({ entries }) }),
    save: (revision, changes) =>
      apiFetch(path, { method: 'PATCH', body: JSON.stringify({ revision, changes }) }),
    remove: async () => {
      await apiFetch(path, { method: 'DELETE' })
    }
  }
}

function getStore(workspaceId: string): WorkspaceStateStore {
  let store = stores.get(workspaceId)
  if (!store) {
    store = new WorkspaceStateStore(transport(workspaceId), () => {
      listeners.get(workspaceId)?.forEach((notify) => notify())
    })
    stores.set(workspaceId, store)
  }
  return store
}

channel?.addEventListener('message', (event) => {
  const workspaceId = event.data?.workspaceId
  if (typeof workspaceId !== 'string' || !stores.has(workspaceId)) return
  void getStore(workspaceId)
    .load()
    .catch(() => {})
})

export async function ensureWorkspaceState(workspaceId: string, readonly = false): Promise<void> {
  await getStore(workspaceId).ensure(
    () => collectBrowserWorkspaceState(workspaceId, localStorage),
    !readonly
  )
}

export async function reloadWorkspaceState(workspaceId: string, readonly = false): Promise<void> {
  await getStore(workspaceId).load(
    () => collectBrowserWorkspaceState(workspaceId, localStorage),
    !readonly
  )
}

export function readWorkspaceState(workspaceId: string): Storage {
  return getStore(workspaceId).storage
}

export async function mutateWorkspaceState<T>(
  workspaceId: string,
  operation: (storage: Storage) => T
): Promise<T> {
  await ensureWorkspaceState(workspaceId)
  const result = await getStore(workspaceId).transaction(operation)
  channel?.postMessage({ workspaceId })
  return result
}

export async function deleteWorkspaceState(workspaceId: string): Promise<void> {
  await getStore(workspaceId).remove()
  const migrated = collectBrowserWorkspaceState(workspaceId, localStorage)
  Object.keys(migrated).forEach((key) => localStorage.removeItem(key))
  channel?.postMessage({ workspaceId })
}

export function subscribeWorkspaceState(workspaceId: string, notify: () => void): () => void {
  let group = listeners.get(workspaceId)
  if (!group) {
    group = new Set()
    listeners.set(workspaceId, group)
  }
  group.add(notify)
  return () => {
    group?.delete(notify)
    if (!group?.size) listeners.delete(workspaceId)
  }
}
