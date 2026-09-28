import { axiosInst } from '@/shared/api/httpClient'
import type { WorkspaceStateTransport } from '../model/workspaceStateStore'

export function workspaceStateTransport(workspaceId: string): WorkspaceStateTransport {
  const base = `/workspace_state/${encodeURIComponent(workspaceId)}`
  const config = { handledLocally: true }
  return {
    load: async () => (await axiosInst.value.get(base, config)).data,
    import: async (entries) =>
      (await axiosInst.value.post(`${base}/import`, { entries }, config)).data,
    save: async (revision, changes) =>
      (await axiosInst.value.patch(base, { revision, changes }, config)).data,
    remove: async () => {
      await axiosInst.value.delete(base, config)
    }
  }
}
