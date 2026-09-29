import type { MediaKind, ToolKey, WorkspaceAsset } from './workspaceModel.ts'
import type { StudioDocumentIndex } from '../../image-editor/public/document.ts'
import {
  createWorkspaceDraftRepository,
  workspaceImageDocumentKey,
  workspaceImageIndexKey
} from './workspaceDraftRepository.ts'
import type { StudioDraftRepository } from '../../image-editor/public/document.ts'

export type ProductionKind = MediaKind | 'ai'
export interface ProductionSource {
  documentId: string
  revision: string
  scope: string
  label: string
  inputArea: 'content' | 'canvas'
  layerIds: string[]
  inputPaths: string[]
  referencePaths: string[]
  referenceInputs?: { path: string; sourcePath: string }[]
  inputPath: string
}
export interface ProductionDraft {
  id: string
  name: string
  kind: ProductionKind
  createdAt: string
  updatedAt: string
  brief: string
  /** Initial image task for legacy files and creation shortcuts; not a fixed file purpose. */
  aiPurpose?: 'image_edit' | 'image_generation'
  source?: ProductionSource
}
/** A business outcome can contain several media and independently editable drafts. */
export interface WorkspaceWork {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  brief: string
  /** Retained for compatibility; old associations are available in the shared workspace pool. */
  assets: WorkspaceAsset[]
  outputs: WorkspaceAsset[]
  drafts: ProductionDraft[]
  activeDraftId: string
  lastTool: ToolKey
}
export interface WorkspaceWorkState {
  version: 2
  activeId: string
  works: WorkspaceWork[]
}
export const workspaceWorksKey = (id: string) => `omnigallery:workspace-works-v2:${id}`
export const legacyWorkspaceWorksKey = (id: string) => `omnigallery:workspace-works-v1:${id}`
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const kinds: ProductionKind[] = ['image', 'video', 'audio', 'ai']
const tools: ToolKey[] = ['image', 'media', 'ai']
const text = (v: unknown, limit: number) => (typeof v === 'string' ? v.slice(0, limit) : '')
const validId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,80}$/.test(v)
function readProductionSource(value: unknown): ProductionSource | undefined {
  if (
    !object(value) ||
    !validId(value.documentId) ||
    !/^[a-f0-9]{64}$/.test(String(value.revision)) ||
    !['content', 'canvas'].includes(String(value.inputArea)) ||
    !text(value.inputPath, 2048)
  )
    return
  const strings = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.filter((s): s is string => typeof s === 'string' && s.length <= 2048))].slice(
          0,
          500
        )
      : []
  return {
    documentId: value.documentId,
    revision: String(value.revision),
    scope: text(value.scope, 20000),
    label: text(value.label, 200),
    inputArea: value.inputArea as ProductionSource['inputArea'],
    layerIds: strings(value.layerIds),
    inputPaths: strings(value.inputPaths),
    referencePaths: strings(value.referencePaths),
    ...(Array.isArray(value.referenceInputs)
      ? {
          referenceInputs: value.referenceInputs
            .filter((item) => object(item) && text(item.path, 2048) && text(item.sourcePath, 2048))
            .slice(0, 13)
            .map((item) => ({
              path: text(item.path, 2048),
              sourcePath: text(item.sourcePath, 2048)
            }))
        }
      : {}),
    inputPath: text(value.inputPath, 2048)
  }
}
export const draftTool = (kind: ProductionKind): ToolKey =>
  kind === 'ai' ? 'ai' : kind === 'image' ? 'image' : 'media'
export const draftKindLabel = (kind: ProductionKind) =>
  ({ image: '图片画布', video: '视频剪辑', audio: '音频制作', ai: 'AI 生成' })[kind]
function assets(value: unknown): WorkspaceAsset[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .flatMap((item): WorkspaceAsset[] => {
      if (
        !object(item) ||
        !text(item.path, 2048) ||
        seen.has(String(item.path)) ||
        !['image', 'video', 'audio'].includes(String(item.kind))
      )
        return []
      const path = text(item.path, 2048)
      seen.add(path)
      return [
        {
          path,
          name: text(item.name, 200),
          kind: item.kind as MediaKind,
          ...(typeof item.id === 'number' && Number.isFinite(item.id) ? { id: item.id } : {})
        }
      ]
    })
    .slice(0, 500)
}
export function createProductionDraft(
  kind: ProductionKind,
  name: string,
  id: string = crypto.randomUUID()
): ProductionDraft {
  const now = new Date().toISOString()
  return { id, name: name.trim().slice(0, 80), kind, brief: '', createdAt: now, updatedAt: now }
}
export function createWorkspaceWork(name: string, id: string = crypto.randomUUID()): WorkspaceWork {
  const now = new Date().toISOString()
  return {
    id,
    name: name.trim().slice(0, 80),
    brief: '',
    createdAt: now,
    updatedAt: now,
    assets: [],
    outputs: [],
    drafts: [],
    activeDraftId: '',
    lastTool: 'image'
  }
}
export function readWorkspaceWorkState(value: unknown): WorkspaceWorkState {
  const empty: WorkspaceWorkState = { version: 2, activeId: '', works: [] }
  if (!object(value) || ![1, 2].includes(Number(value.version)) || !Array.isArray(value.works))
    return empty
  const seen = new Set<string>(),
    draftIds = new Set<string>()
  const works = value.works
    .flatMap((item): WorkspaceWork[] => {
      if (!object(item) || !validId(item.id) || seen.has(item.id) || !text(item.name, 80).trim())
        return []
      if (value.version === 1 && !kinds.includes(item.kind as ProductionKind)) return []
      seen.add(item.id)
      const rawDrafts =
        value.version === 1
          ? [{ ...item, name: text(item.name, 80), kind: item.kind }]
          : Array.isArray(item.drafts)
            ? item.drafts
            : []
      const drafts = rawDrafts
        .flatMap((draft): ProductionDraft[] => {
          if (
            !object(draft) ||
            !validId(draft.id) ||
            draftIds.has(draft.id) ||
            !kinds.includes(draft.kind as ProductionKind) ||
            !text(draft.name, 80).trim()
          )
            return []
          draftIds.add(draft.id)
          return [
            {
              id: draft.id,
              name: text(draft.name, 80).trim(),
              kind: draft.kind as ProductionKind,
              createdAt: text(draft.createdAt, 80),
              updatedAt: text(draft.updatedAt, 80),
              brief: text(draft.brief, 5000),
              ...(draft.kind === 'ai' && draft.aiPurpose === 'image_generation'
                ? { aiPurpose: 'image_generation' as const }
                : {}),
              ...(draft.kind === 'ai' && readProductionSource(draft.source)
                ? { source: readProductionSource(draft.source) }
                : {})
            }
          ]
        })
        .slice(0, 200)
      const active = value.version === 1 ? item.id : item.activeDraftId
      return [
        {
          id: item.id,
          name: text(item.name, 80).trim(),
          brief: text(item.brief, 5000),
          createdAt: text(item.createdAt, 80),
          updatedAt: text(item.updatedAt, 80),
          assets: assets(item.assets),
          outputs: assets(item.outputs),
          drafts,
          activeDraftId: drafts.some((draft) => draft.id === active) ? String(active) : '',
          lastTool: tools.includes(item.lastTool as ToolKey) ? (item.lastTool as ToolKey) : 'image'
        }
      ]
    })
    .slice(0, 200)
  return {
    version: 2,
    works,
    activeId: works.some((work) => work.id === value.activeId) ? String(value.activeId) : ''
  }
}
/** Image documents update draft names, never business work names or goals. */
export function reconcileImageDrafts(
  state: WorkspaceWorkState,
  docs: StudioDocumentIndex['docs']
): WorkspaceWorkState {
  const byId = new Map(docs.map((doc) => [doc.id, doc])),
    assigned = new Set<string>()
  const works = state.works.map((work) => {
    const drafts = work.drafts.flatMap((draft): ProductionDraft[] => {
      if (draft.kind !== 'image') return [draft]
      const doc = byId.get(draft.id)
      if (!doc) return []
      assigned.add(doc.id)
      return [
        {
          ...draft,
          name: doc.name,
          updatedAt: doc.updatedAt > draft.updatedAt ? doc.updatedAt : draft.updatedAt
        }
      ]
    })
    return {
      ...work,
      drafts,
      activeDraftId: drafts.some((draft) => draft.id === work.activeDraftId)
        ? work.activeDraftId
        : ''
    }
  })
  const unassigned = docs.filter((doc) => !assigned.has(doc.id))
  if (unassigned.length) {
    let legacy = works.find((work) => work.id === 'legacy-image-drafts')
    if (!legacy) {
      legacy = createWorkspaceWork('原有图片创作', 'legacy-image-drafts')
      legacy.createdAt = legacy.updatedAt = unassigned[0].updatedAt
      works.push(legacy)
    }
    legacy.drafts = [
      ...legacy.drafts,
      ...unassigned.map((doc) => ({
        ...createProductionDraft('image', doc.name, doc.id),
        createdAt: doc.updatedAt,
        updatedAt: doc.updatedAt
      }))
    ]
  }
  return {
    version: 2,
    works,
    activeId: works.some((work) => work.id === state.activeId) ? state.activeId : ''
  }
}
export function createWorkspaceWorksRepository(
  workspaceId: string,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
) {
  const key = workspaceWorksKey(workspaceId)
  return {
    load(): WorkspaceWorkState {
      const raw =
        storage.getItem(key) ?? storage.getItem(legacyWorkspaceWorksKey(workspaceId)) ?? 'null'
      const images = createWorkspaceDraftRepository(workspaceId, storage)
      const result = reconcileImageDrafts(
        readWorkspaceWorkState(JSON.parse(raw)),
        images.loadIndex()?.docs ?? []
      )
      return result
    },
    save(state: WorkspaceWorkState) {
      storage.setItem(key, JSON.stringify(state))
    },
    clear() {
      storage.removeItem(key)
      storage.removeItem(legacyWorkspaceWorksKey(workspaceId))
    }
  }
}

/** A delayed AI save must not recreate state for a deleted production file. */
export function assertProductionDraftExists(
  storage: DraftStorage,
  workspaceId: string,
  draftId: string
) {
  if (
    !createWorkspaceWorksRepository(workspaceId, storage)
      .load()
      .works.some((work) => work.drafts.some((draft) => draft.id === draftId))
  )
    throw new Error('制作文件已删除，请重新打开作品；本次修改尚未保存')
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function storageTransaction<T>(
  storage: DraftStorage,
  keys: string[],
  operation: () => T
): T {
  const before = new Map(keys.map((key) => [key, storage.getItem(key)]))
  try {
    return operation()
  } catch (error) {
    for (const [key, value] of before) {
      if (value === null) storage.removeItem(key)
      else storage.setItem(key, value)
    }
    throw error
  }
}
/** Editors see only one work's image drafts; the canonical workspace index remains shared. */
export function createWorkImageDraftRepository(
  workspaceId: string,
  workId: string,
  storage: DraftStorage
): StudioDraftRepository {
  const images = createWorkspaceDraftRepository(workspaceId, storage)
  const works = createWorkspaceWorksRepository(workspaceId, storage)
  const observedIds = new Set<string>()
  function context() {
    const state = works.load()
    const work = state.works.find((item) => item.id === workId)
    if (!work) throw new Error('作品已不存在')
    return { state, work }
  }
  return {
    loadIndex() {
      const { work } = context()
      const ids = new Set(
        work.drafts.filter((draft) => draft.kind === 'image').map((draft) => draft.id)
      )
      ids.forEach((id) => observedIds.add(id))
      return {
        version: 2,
        activeId: ids.has(work.activeDraftId) ? work.activeDraftId : '',
        docs: (images.loadIndex()?.docs ?? []).filter((doc) => ids.has(doc.id))
      }
    },
    loadDocument(id) {
      return context().work.drafts.some((draft) => draft.id === id && draft.kind === 'image')
        ? images.loadDocument(id)
        : undefined
    },
    save(document, index) {
      const { state, work } = context()
      const foreignIds = new Set(
        state.works.flatMap((item) =>
          item.drafts
            .filter((draft) => item.id !== workId || draft.kind !== 'image')
            .map((draft) => draft.id)
        )
      )
      if (foreignIds.has(document.id) || index.docs.some((doc) => foreignIds.has(doc.id)))
        throw new Error('草稿属于其他作品或制作类型')
      const existing = work.drafts.find((draft) => draft.id === document.id)
      if (!existing && observedIds.has(document.id)) throw new Error('草稿已删除，请重新打开作品')
      if (
        !existing &&
        (work.drafts.length >= 200 ||
          work.drafts.filter((draft) => draft.kind === 'image').length >= 100)
      )
        throw new Error('草稿数量已达到上限')
      // A session's index may be stale. Only the document being saved changes;
      // additions, renames and explicit deletions in other windows remain intact.
      const meta = { id: document.id, name: document.name, updatedAt: document.updatedAt }
      const currentDocs = images.loadIndex()?.docs ?? []
      const docs = currentDocs.some((doc) => doc.id === document.id)
        ? currentDocs.map((doc) => (doc.id === document.id ? meta : doc))
        : [...currentDocs, meta]
      const drafts = existing
        ? work.drafts.map((draft) => (draft.id === document.id ? { ...draft, ...meta } : draft))
        : [
            ...work.drafts,
            {
              ...createProductionDraft('image', document.name, document.id),
              updatedAt: document.updatedAt
            }
          ]
      storageTransaction(
        storage,
        [
          workspaceWorksKey(workspaceId),
          workspaceImageIndexKey(workspaceId),
          workspaceImageDocumentKey(workspaceId, document.id)
        ],
        () => {
          images.save(document, {
            version: 2,
            activeId: document.id,
            docs
          })
          works.save({
            ...state,
            works: state.works.map((item) =>
              item.id === workId
                ? {
                    ...work,
                    drafts,
                    activeDraftId: document.id,
                    updatedAt: document.updatedAt
                  }
                : item
            )
          })
        }
      )
      observedIds.add(document.id)
    },
    remove(id) {
      const { state, work } = context()
      if (!work.drafts.some((draft) => draft.kind === 'image' && draft.id === id))
        throw new Error('草稿不属于当前作品')
      storageTransaction(
        storage,
        [
          workspaceWorksKey(workspaceId),
          workspaceImageIndexKey(workspaceId),
          workspaceImageDocumentKey(workspaceId, id)
        ],
        () => {
          images.deleteEntry(id)
          works.save({
            ...state,
            works: state.works.map((item) =>
              item.id === workId
                ? {
                    ...work,
                    drafts: work.drafts.filter((draft) => draft.id !== id),
                    activeDraftId: work.activeDraftId === id ? '' : work.activeDraftId
                  }
                : item
            )
          })
        }
      )
    }
  }
}
