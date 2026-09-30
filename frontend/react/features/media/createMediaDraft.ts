import { apiFetch } from '../../shared/apiClient'
import {
  ensureWorkspaceState,
  mutateWorkspaceState,
  readWorkspaceState
} from '../../shared/workspaceState'
import {
  createImageLayer,
  createStudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel'
import { fileDisplayName } from '../../../src/shared/lib/fileDisplayName'
import {
  addWorkspaceAssets,
  readWorkspaceRecords
} from '../../../src/features/workspaces/model/workspaceModel'
import {
  createProductionDraft,
  createWorkImageDraftRepository,
  createWorkspaceWorksRepository,
  draftTool,
  type ProductionKind
} from '../../../src/features/workspaces/model/workspaceWorks'
import { mediaKind, rawMediaUrl, type MediaFile } from './mediaApi'

export interface MediaDraftTarget {
  workspaceId: string
  workspaceName: string
  works: { id: string; name: string }[]
  preferredWorkId: string
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

export async function readMediaDraftTarget(): Promise<MediaDraftTarget> {
  const settings = await apiFetch<{
    is_readonly: boolean
    app_fe_setting?: { workbench_projects?: unknown }
  }>('/global_setting')
  if (settings.is_readonly) throw new Error('当前处于只读模式，无法新建制作文件')
  const workspaceId = localStorage.getItem('omnigallery:workbench-current-workspace') || ''
  const workspace = readWorkspaceRecords(settings.app_fe_setting?.workbench_projects).find(
    (item) => item.id === workspaceId
  )
  if (!workspace) throw new Error('请先在工作台选择工作区')
  await ensureWorkspaceState(workspaceId)
  const state = createWorkspaceWorksRepository(workspaceId, readWorkspaceState(workspaceId)).load()
  if (!state.works.length) throw new Error('请先在工作台创建作品')
  const remembered = sessionStorage.getItem('omnigallery:workbench-current-work')
  const rememberedWorkId = remembered?.startsWith(`${workspaceId}:`)
    ? remembered.slice(workspaceId.length + 1)
    : ''
  return {
    workspaceId,
    workspaceName: workspace.name,
    works: state.works.map((work) => ({ id: work.id, name: work.name })),
    preferredWorkId:
      state.works.find((work) => work.id === rememberedWorkId)?.id ||
      state.works.find((work) => work.id === state.activeId)?.id ||
      state.works[0].id
  }
}

export async function createMediaDraft(
  file: MediaFile,
  target: MediaDraftTarget,
  workId: string,
  requestedName: string
): Promise<{ kind: 'image' | 'audio' | 'video'; draftId: string }> {
  const kind = mediaKind(file)
  if (kind === 'other') throw new Error('此文件类型暂不支持制作')
  const name = requestedName.trim().slice(0, 80) || `${fileDisplayName(file.name)} · 制作`
  const draftId = crypto.randomUUID()
  const asset = { path: file.fullpath, name: file.name, kind }
  const dimensions = kind === 'image' ? await imageDimensions(file) : undefined
  await mutateWorkspaceState(target.workspaceId, (storage) => {
    const repository = createWorkspaceWorksRepository(target.workspaceId, storage)
    const current = repository.load()
    const work = current.works.find((item) => item.id === workId)
    if (!work) throw new Error('目标作品已不存在，请重新选择')
    if (work.drafts.length >= 200) throw new Error('作品中的制作文件已达到上限')
    const now = new Date().toISOString()
    repository.save({
      ...current,
      activeId: workId,
      works: current.works.map((item) =>
        item.id === workId
          ? {
              ...item,
              assets: addWorkspaceAssets(item.assets, [asset]),
              updatedAt: now
            }
          : item
      )
    })
    if (kind === 'image') {
      const document = createStudioDocument(name, now)
      document.id = draftId
      const naturalWidth = dimensions?.width || 810
      const naturalHeight = dimensions?.height || 810
      const scale = Math.min(1, 810 / naturalWidth, 810 / naturalHeight)
      const width = Math.max(16, Math.round(naturalWidth * scale))
      const height = Math.max(16, Math.round(naturalHeight * scale))
      const imageLayer = createImageLayer(
        file.fullpath,
        {
          x: Math.round((document.width - width) / 2),
          y: Math.round((document.height - height) / 2),
          width,
          height
        },
        file.name
      )
      imageLayer.fit = 'contain'
      document.layers = [imageLayer]
      const images = createWorkImageDraftRepository(target.workspaceId, workId, storage)
      const index = images.loadIndex()
      if (!index || index.docs.length >= 100) throw new Error('图片制作文件已达到上限')
      images.save(document, index)
    } else {
      const draft = createProductionDraft(kind as ProductionKind, name, draftId)
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
                lastTool: draftTool(kind),
                updatedAt: now
              }
            : item
        )
      })
    }
  })
  localStorage.setItem('omnigallery:workbench-current-workspace', target.workspaceId)
  sessionStorage.setItem('omnigallery:workbench-current-work', `${target.workspaceId}:${workId}`)
  return { kind, draftId }
}
