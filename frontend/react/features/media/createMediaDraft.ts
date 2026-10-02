import { apiFetch } from '../../shared/apiClient'
import {
  ensureWorkspaceState,
  mutateWorkspaceState,
  readWorkspaceState
} from '../../shared/workspaceState'
import { fileDisplayName } from '../../../src/shared/lib/fileDisplayName'
import {
  readWorkspaceRecords,
  type WorkspaceRecord
} from '../../../src/features/workspaces/model/workspaceModel'
import { createWorkspaceWorksRepository } from '../../../src/features/workspaces/model/workspaceWorks'
import {
  mediaDraftTarget,
  mediaDraftWorkspaces,
  resolveMediaDraftWorkspace,
  saveMediaDraft,
  type MediaDraftDestination
} from './mediaDraftModel'
import { mediaKind, rawMediaUrl, type MediaFile } from './mediaApi'

type MediaDraftSettings = {
  is_readonly: boolean
  app_fe_setting?: { workbench_projects?: unknown }
}

async function readSettings(): Promise<MediaDraftSettings> {
  const settings = await apiFetch<MediaDraftSettings>('/global_setting')
  if (settings.is_readonly) throw new Error('当前处于只读模式，无法新建制作文件')
  return settings
}

async function imageDimensions(file: MediaFile): Promise<{ width: number; height: number }> {
  if (file.width && file.height) return { width: file.width, height: file.height }
  const image = new Image()
  image.src = rawMediaUrl(file)
  try {
    await image.decode()
    return { width: image.naturalWidth, height: image.naturalHeight }
  } catch {
    return { width: 810, height: 810 }
  }
}

export async function readMediaDraftWorkspaces() {
  const settings = await readSettings()
  return mediaDraftWorkspaces(
    settings.app_fe_setting?.workbench_projects,
    localStorage.getItem('omnigallery:workbench-current-workspace') || ''
  )
}

export async function readMediaDraftTarget(workspace: Pick<WorkspaceRecord, 'id' | 'name'>) {
  await ensureWorkspaceState(workspace.id)
  const state = createWorkspaceWorksRepository(
    workspace.id,
    readWorkspaceState(workspace.id)
  ).load()
  return mediaDraftTarget(
    workspace,
    state,
    sessionStorage.getItem('omnigallery:workbench-current-work') || ''
  )
}

export async function createMediaDraft(
  file: MediaFile,
  destination: MediaDraftDestination,
  requestedName: string
): Promise<{ kind: 'image' | 'audio' | 'video'; draftId: string }> {
  const kind = mediaKind(file)
  if (kind === 'other') throw new Error('此文件类型暂不支持制作')
  if ('newId' in destination.work && !destination.work.name.trim())
    throw new Error('请输入作品名称')
  const name = requestedName.trim().slice(0, 80) || `${fileDisplayName(file.name)} · 制作`
  const dimensions = kind === 'image' ? await imageDimensions(file) : undefined
  // Re-read the workspace list at submission instead of overwriting settings loaded by the dialog.
  const settings = await readSettings()
  const records = readWorkspaceRecords(settings.app_fe_setting?.workbench_projects)
  const { workspace, created } = resolveMediaDraftWorkspace(
    records,
    destination.workspace,
    kind,
    new Date().toISOString()
  )
  if (created)
    await apiFetch<void>('/app_fe_setting', {
      method: 'POST',
      body: JSON.stringify({
        name: 'workbench_projects',
        value: JSON.stringify({ version: 2, items: [workspace, ...records] })
      })
    })
  const draftId = crypto.randomUUID()
  const asset = {
    path: file.fullpath,
    name: file.name,
    kind,
    ...(typeof file.id === 'number' ? { id: file.id } : {})
  }
  const workId = await mutateWorkspaceState(workspace.id, (storage) =>
    saveMediaDraft(storage, workspace.id, destination.work, asset, name, draftId, dimensions)
  )
  localStorage.setItem('omnigallery:workbench-current-workspace', workspace.id)
  sessionStorage.setItem('omnigallery:workbench-current-work', `${workspace.id}:${workId}`)
  return { kind, draftId }
}
