import {
  createImageLayer,
  createStudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel.ts'
import {
  addWorkspaceAssets,
  readWorkspaceRecords,
  type WorkspaceAsset,
  type WorkspaceRecord
} from '../../../src/features/workspaces/model/workspaceModel.ts'
import {
  createProductionDraft,
  createWorkImageDraftRepository,
  createWorkspaceWork,
  createWorkspaceWorksRepository,
  draftTool,
  type WorkspaceWorkState
} from '../../../src/features/workspaces/model/workspaceWorks.ts'

export interface MediaDraftTarget {
  workspaceId: string
  workspaceName: string
  works: { id: string; name: string }[]
  preferredWorkId: string
}

export type MediaDraftDestination = {
  workspace: { id: string } | { newId: string; name: string }
  work: { id: string } | { newId: string; name: string }
}

export function mediaDraftWorkspaces(value: unknown, rememberedId: string) {
  const workspaces = readWorkspaceRecords(value).sort((a, b) =>
    (b.lastOpenedAt || b.updatedAt).localeCompare(a.lastOpenedAt || a.updatedAt)
  )
  return {
    workspaces,
    preferredWorkspaceId:
      workspaces.find((item) => item.id === rememberedId)?.id || workspaces[0]?.id || ''
  }
}

export function mediaDraftTarget(
  workspace: Pick<WorkspaceRecord, 'id' | 'name'>,
  state: WorkspaceWorkState,
  remembered: string
): MediaDraftTarget {
  const rememberedWorkId = remembered.startsWith(`${workspace.id}:`)
    ? remembered.slice(workspace.id.length + 1)
    : ''
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    works: state.works.map((work) => ({ id: work.id, name: work.name })),
    preferredWorkId:
      state.works.find((work) => work.id === rememberedWorkId)?.id ||
      state.works.find((work) => work.id === state.activeId)?.id ||
      state.works[0]?.id ||
      ''
  }
}

export function resolveMediaDraftWorkspace(
  records: WorkspaceRecord[],
  destination: MediaDraftDestination['workspace'],
  kind: WorkspaceAsset['kind'],
  now: string
): { workspace: WorkspaceRecord; created: boolean } {
  const id = 'id' in destination ? destination.id : destination.newId
  const existing = records.find((workspace) => workspace.id === id)
  if (existing) return { workspace: existing, created: false }
  if ('id' in destination) throw new Error('工作区已不存在，请重新选择')
  const name = destination.name.trim().slice(0, 80)
  if (!name) throw new Error('请输入工作区名称')
  if (records.length >= 100) throw new Error('工作区数量已达到上限')
  return {
    created: true,
    workspace: {
      id,
      name,
      brief: '',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      lastTool: draftTool(kind),
      assets: [],
      outputs: [],
      notes: {}
    }
  }
}

/** Run inside the workspace store transaction so failed writes leave no partial work or draft. */
export function saveMediaDraft(
  storage: Storage,
  workspaceId: string,
  destination: MediaDraftDestination['work'],
  asset: WorkspaceAsset,
  name: string,
  draftId: string,
  dimensions?: { width: number; height: number }
): string {
  const repository = createWorkspaceWorksRepository(workspaceId, storage)
  const current = repository.load()
  const workId = 'id' in destination ? destination.id : destination.newId
  let work = current.works.find((item) => item.id === workId)
  if (!work) {
    if ('id' in destination) throw new Error('目标作品已不存在，请重新选择')
    if (current.works.length >= 200) throw new Error('作品数量已达到上限')
    const workName = destination.name.trim().slice(0, 80)
    if (!workName) throw new Error('请输入作品名称')
    work = createWorkspaceWork(workName, workId)
  }
  if (work.drafts.length >= 200) throw new Error('作品中的制作文件已达到上限')
  const assets = addWorkspaceAssets(work.assets, [asset])
  if (!assets.some((item) => item.path === asset.path)) throw new Error('作品素材已达到上限')
  const now = new Date().toISOString()
  const updatedWork = { ...work, assets, updatedAt: now, lastOpenedAt: now }
  repository.save({
    ...current,
    activeId: workId,
    works: current.works.some((item) => item.id === workId)
      ? current.works.map((item) => (item.id === workId ? updatedWork : item))
      : [...current.works, updatedWork]
  })
  if (asset.kind === 'image') {
    const document = createStudioDocument(name, now)
    document.id = draftId
    const naturalWidth = dimensions?.width || 810
    const naturalHeight = dimensions?.height || 810
    const scale = Math.min(1, 810 / naturalWidth, 810 / naturalHeight)
    const width = Math.max(16, Math.round(naturalWidth * scale))
    const height = Math.max(16, Math.round(naturalHeight * scale))
    const imageLayer = createImageLayer(
      asset.path,
      {
        x: Math.round((document.width - width) / 2),
        y: Math.round((document.height - height) / 2),
        width,
        height
      },
      asset.name
    )
    imageLayer.fit = 'contain'
    document.layers = [imageLayer]
    const images = createWorkImageDraftRepository(workspaceId, workId, storage)
    const index = images.loadIndex()
    if (!index || index.docs.length >= 100) throw new Error('图片制作文件已达到上限')
    images.save(document, index)
  } else {
    const draft = createProductionDraft(asset.kind, name, draftId)
    const updated = repository.load()
    repository.save({
      ...updated,
      activeId: workId,
      works: updated.works.map((item) =>
        item.id === workId
          ? {
              ...item,
              drafts: [...item.drafts, draft],
              activeDraftId: draftId,
              lastTool: draftTool(asset.kind),
              updatedAt: now
            }
          : item
      )
    })
  }
  return workId
}
