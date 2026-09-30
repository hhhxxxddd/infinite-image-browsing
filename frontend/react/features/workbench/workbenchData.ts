import {
  createWorkspaceWorksRepository,
  type WorkspaceWorkState
} from '../../../src/features/workspaces/model/workspaceWorks'
import {
  ensureWorkspaceState,
  readWorkspaceState,
  mutateWorkspaceState,
  reloadWorkspaceState,
  deleteWorkspaceState
} from '../../shared/workspaceState'

export async function loadWorkspaceWorks(workspaceId: string, readonly = false) {
  await ensureWorkspaceState(workspaceId, readonly)
  return createWorkspaceWorksRepository(workspaceId, readWorkspaceState(workspaceId)).load()
}

export async function reloadWorkspaceWorks(workspaceId: string, readonly = false) {
  await reloadWorkspaceState(workspaceId, readonly)
  return createWorkspaceWorksRepository(workspaceId, readWorkspaceState(workspaceId)).load()
}

export async function changeWorkspaceWorks<T>(
  workspaceId: string,
  operation: (storage: Storage, state: WorkspaceWorkState) => T
): Promise<{ result: T; state: WorkspaceWorkState }> {
  const result = await mutateWorkspaceState(workspaceId, (storage) => {
    const current = createWorkspaceWorksRepository(workspaceId, storage).load()
    return operation(storage, current)
  })
  return {
    result,
    state: createWorkspaceWorksRepository(workspaceId, readWorkspaceState(workspaceId)).load()
  }
}

export async function deleteWorkspaceWorks(workspaceId: string) {
  await deleteWorkspaceState(workspaceId)
}
