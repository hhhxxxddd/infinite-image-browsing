import { computed, ref, watch } from 'vue'
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { audioTimelineKey } from '../../media-editor/model/audioTimeline'
import { deleteWorkspaceInputs } from '../api/workspaceArtifacts'
import { createStudioDocument } from '@/features/image-editor/public/document'
import { createWorkspaceDraftRepository } from '../model/workspaceDraftRepository'
import { removeWorkspaceAIDrafts } from '../model/workspaceReferences'
import {
  ensureWorkspaceStorage,
  reloadWorkspaceStorage,
  saveWorkspaceState,
  workspaceStorage,
  workspaceStorageRevision
} from '../services/workspaceStorage'
import {
  createProductionDraft,
  createWorkspaceWork,
  createWorkspaceWorksRepository,
  createWorkImageDraftRepository,
  draftTool,
  type WorkspaceWork,
  type WorkspaceWorkState,
  type ProductionDraft,
  type ProductionKind
} from '../model/workspaceWorks'

export function useWorkspaceWorks(workspaceId: () => string | undefined, readonly: () => boolean) {
  const empty = (): WorkspaceWorkState => ({ version: 2, activeId: '', works: [] })
  const state = ref<WorkspaceWorkState>(empty()),
    error = ref(''),
    ready = ref(false)
  const repository = (id: string, storage = workspaceStorage(id)) =>
    createWorkspaceWorksRepository(id, storage)
  function readCache() {
    const id = workspaceId()
    if (!id || !ready.value) return
    const previous = state.value,
      next = repository(id).load()
    const active = next.works.find((work) => work.id === previous.activeId)
    const oldDraft = previous.works.find((work) => work.id === previous.activeId)?.activeDraftId
    if (active) {
      next.activeId = active.id
      if (active.drafts.some((draft) => draft.id === oldDraft))
        active.activeDraftId = oldDraft ?? ''
    } else next.activeId = ''
    state.value = next
  }
  async function refresh(reload = false) {
    const id = workspaceId()
    if (!id) {
      state.value = empty()
      ready.value = false
      error.value = ''
      return
    }
    try {
      if (reload) await reloadWorkspaceStorage(id, readonly())
      else await ensureWorkspaceStorage(id, readonly())
      if (workspaceId() !== id) return
      if (ready.value) readCache()
      else {
        ready.value = true
        state.value = repository(id).load()
      }
      error.value = ''
    } catch (cause) {
      if (workspaceId() === id) error.value = getErrorMessage(cause, '无法读取本机作品，请重试。')
    }
  }
  watch(
    workspaceId,
    () => {
      state.value = empty()
      ready.value = false
      void refresh()
    },
    { immediate: true }
  )
  watch(workspaceStorageRevision, () => {
    if (ready.value) readCache()
  })
  async function mutate<T>(
    operation: (storage: Storage, current: WorkspaceWorkState, id: string) => T
  ): Promise<T | undefined> {
    const id = workspaceId()
    if (!id || readonly() || !ready.value || error.value) return
    try {
      const result = await saveWorkspaceState(id, (storage) =>
        operation(storage, repository(id, storage).load(), id)
      )
      if (workspaceId() === id) {
        readCache()
        error.value = ''
      }
      return result
    } catch (cause) {
      if (workspaceId() === id) error.value = getErrorMessage(cause, '作品或草稿尚未保存，请重试。')
    }
  }
  async function select(id: string) {
    if (!state.value.works.some((work) => work.id === id)) return false
    if (readonly()) {
      state.value = { ...state.value, activeId: id }
      return true
    }
    const selected = !!(await mutate((storage, current, scope) => {
      if (!current.works.some((work) => work.id === id)) throw new Error('作品已不存在')
      repository(scope, storage).save({ ...current, activeId: id })
      return true
    }))
    if (selected) state.value.activeId = id
    return selected
  }
  async function update(work: WorkspaceWork) {
    return !!(await mutate((storage, current, id) => {
      const existing = current.works.find((item) => item.id === work.id)
      if (!existing) throw new Error('作品已不存在')
      // Metadata updates cannot discard drafts saved by an editor in the meantime.
      repository(id, storage).save({
        ...current,
        works: current.works.map((item) =>
          item.id === work.id
            ? {
                ...existing,
                name: work.name,
                brief: work.brief,
                assets: work.assets,
                outputs: work.outputs,
                lastTool: work.lastTool,
                updatedAt: new Date().toISOString()
              }
            : item
        )
      })
      return true
    }))
  }
  async function create(name: string, brief: string) {
    if (!name.trim()) return
    const work = await mutate((storage, current, id) => {
      if (current.works.length >= 200) return
      const work = { ...createWorkspaceWork(name), brief }
      repository(id, storage).save({
        version: 2,
        activeId: work.id,
        works: [work, ...current.works]
      })
      return work
    })
    if (work) state.value.activeId = work.id
    return work
  }
  async function createDraft(
    work: WorkspaceWork,
    kind: ProductionKind,
    name: string,
    brief: string,
    aiPurpose?: ProductionDraft['aiPurpose']
  ) {
    if (!name.trim()) return
    return mutate((storage, current, id) => {
      const existing = current.works.find((item) => item.id === work.id)
      if (!existing) throw new Error('作品已不存在')
      if (existing.drafts.length >= 200) return
      const draft = {
        ...createProductionDraft(kind, name),
        brief,
        ...(kind === 'ai' && aiPurpose ? { aiPurpose } : {})
      }
      const works = repository(id, storage)
      if (kind === 'image') {
        const images = createWorkImageDraftRepository(id, work.id, storage)
        const doc = createStudioDocument(name)
        doc.id = draft.id
        const index = images.loadIndex()
        if (!index) throw new Error('无法读取图片草稿列表')
        if (index.docs.length >= 100) return
        images.save(doc, {
          ...index,
          activeId: doc.id,
          docs: [...index.docs, { id: doc.id, name: doc.name, updatedAt: doc.updatedAt }]
        })
        current = works.load()
      }
      works.save({
        ...current,
        works: current.works.map((item) =>
          item.id === work.id
            ? {
                ...item,
                drafts:
                  kind === 'image'
                    ? item.drafts.map((existing) => (existing.id === draft.id ? draft : existing))
                    : [...item.drafts, draft],
                activeDraftId: draft.id,
                lastTool: draftTool(kind)
              }
            : item
        )
      })
      return draft
    })
  }
  async function selectDraft(work: WorkspaceWork, draft: ProductionDraft) {
    if (readonly()) {
      work.activeDraftId = draft.id
      return true
    }
    const selected = !!(await mutate((storage, current, id) => {
      const existing = current.works.find((item) => item.id === work.id)
      if (!existing?.drafts.some((item) => item.id === draft.id)) throw new Error('草稿已不存在')
      repository(id, storage).save({
        ...current,
        works: current.works.map((item) =>
          item.id === work.id
            ? { ...item, activeDraftId: draft.id, lastTool: draftTool(draft.kind) }
            : item
        )
      })
      return true
    }))
    const selectedWork = state.value.works.find((item) => item.id === work.id)
    if (selected && selectedWork) selectedWork.activeDraftId = draft.id
    return selected
  }
  async function updateDraft(
    work: WorkspaceWork,
    draft: ProductionDraft,
    name: string,
    brief: string
  ) {
    return !!(await mutate((storage, current, id) => {
      if (
        !current.works.some(
          (item) => item.id === work.id && item.drafts.some((item) => item.id === draft.id)
        )
      )
        throw new Error('草稿已不存在')
      if (draft.kind === 'image') createWorkspaceDraftRepository(id, storage).rename(draft.id, name)
      repository(id, storage).save({
        ...current,
        works: current.works.map((item) =>
          item.id === work.id
            ? {
                ...item,
                drafts: item.drafts.map((item) =>
                  item.id === draft.id
                    ? { ...item, name, brief, updatedAt: new Date().toISOString() }
                    : item
                )
              }
            : item
        )
      })
      return true
    }))
  }
  async function removeDraft(work: WorkspaceWork, draft: ProductionDraft) {
    const id = workspaceId()
    const removed = !!(await mutate((storage, current, id) => {
      if (
        !current.works.some(
          (item) => item.id === work.id && item.drafts.some((item) => item.id === draft.id)
        )
      )
        throw new Error('草稿已不存在')
      if (draft.kind === 'image')
        createWorkImageDraftRepository(id, work.id, storage).remove(draft.id)
      else {
        repository(id, storage).save({
          ...current,
          works: current.works.map((item) =>
            item.id === work.id
              ? {
                  ...item,
                  drafts: item.drafts.filter((item) => item.id !== draft.id),
                  activeDraftId: item.activeDraftId === draft.id ? '' : item.activeDraftId
                }
              : item
          )
        })
        if (draft.kind === 'ai') removeWorkspaceAIDrafts(storage, `${id}:${work.id}:${draft.id}`)
        if (draft.kind === 'audio') storage.removeItem(audioTimelineKey(id, draft.id))
        if (draft.kind === 'video')
          storage.removeItem(`omnigallery:video-timeline-v1:${id}:${draft.id}`)
      }
      return true
    }))
    if (removed && id && draft.kind === 'ai') {
      try {
        await deleteWorkspaceInputs(id, draft.id)
      } catch {
        error.value = '制作文件已删除，输入快照暂未清理，请稍后重试'
      }
    }
    return removed
  }
  async function remove(work: WorkspaceWork) {
    const id = workspaceId()
    const removed = await mutate((storage, current, id) => {
      const existing = current.works.find((item) => item.id === work.id)
      if (!existing) throw new Error('作品已不存在')
      const images = createWorkspaceDraftRepository(id, storage)
      for (const draft of existing.drafts) {
        if (draft.kind === 'image') images.deleteEntry(draft.id)
        if (draft.kind === 'ai') removeWorkspaceAIDrafts(storage, `${id}:${work.id}:${draft.id}`)
        if (draft.kind === 'audio') storage.removeItem(audioTimelineKey(id, draft.id))
        if (draft.kind === 'video')
          storage.removeItem(`omnigallery:video-timeline-v1:${id}:${draft.id}`)
      }
      repository(id, storage).save({
        ...current,
        activeId: current.activeId === work.id ? '' : current.activeId,
        works: current.works.filter((item) => item.id !== work.id)
      })
      return existing.drafts.filter((draft) => draft.kind === 'ai').map((draft) => draft.id)
    })
    if (removed && id) {
      const cleanup = await Promise.allSettled(
        removed.map((draftId) => deleteWorkspaceInputs(id, draftId))
      )
      if (cleanup.some((result) => result.status === 'rejected'))
        error.value = '作品已删除，部分输入快照暂未清理'
    }
    return !!removed
  }
  const currentWork = computed(() =>
    state.value.works.find((work) => work.id === state.value.activeId)
  )
  return {
    works: computed(() => state.value.works),
    currentWork,
    currentDraft: computed(() =>
      currentWork.value?.drafts.find((draft) => draft.id === currentWork.value?.activeDraftId)
    ),
    error,
    ready,
    refresh,
    select,
    update,
    create,
    createDraft,
    selectDraft,
    updateDraft,
    removeDraft,
    remove
  }
}
