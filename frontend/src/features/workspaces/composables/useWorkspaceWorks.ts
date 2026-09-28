import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createStudioDocument } from '@/features/image-editor/public'
import {
  workspaceImageIndexKey,
  workspaceImageDocumentKey
} from '../model/workspaceDraftRepository'
import {
  createWorkspaceWork,
  createProductionDraft,
  createWorkspaceWorksRepository,
  createWorkImageDraftRepository,
  draftTool,
  workspaceWorksKey,
  storageTransaction,
  type WorkspaceWork,
  type WorkspaceWorkState,
  type ProductionDraft,
  type ProductionKind
} from '../model/workspaceWorks'

export function useWorkspaceWorks(workspaceId: () => string | undefined, readonly: () => boolean) {
  const state = ref<WorkspaceWorkState>({ version: 2, activeId: '', works: [] })
  const error = ref('')
  const repository = () => createWorkspaceWorksRepository(workspaceId() ?? '', localStorage)
  function refresh() {
    if (!workspaceId()) {
      state.value = { version: 2, activeId: '', works: [] }
      error.value = ''
      return
    }
    try {
      state.value = repository().load()
      error.value = ''
    } catch {
      error.value = '无法读取本机作品，请检查存储后重试。'
    }
  }
  watch(
    workspaceId,
    () => {
      state.value = { version: 2, activeId: '', works: [] }
      refresh()
    },
    { immediate: true }
  )
  function persist(next: WorkspaceWorkState): boolean {
    if (!workspaceId() || readonly() || error.value) return false
    try {
      repository().save(next)
      state.value = next
      return true
    } catch {
      error.value = '本机作品保存失败，当前操作尚未保存。'
      return false
    }
  }
  function select(id: string) {
    if (!state.value.works.some((work) => work.id === id)) return false
    if (readonly()) {
      state.value = { ...state.value, activeId: id }
      return true
    }
    if (!persist({ ...state.value, activeId: id })) return false
    refresh()
    return !error.value
  }
  function update(work: WorkspaceWork) {
    if (!state.value.works.some((item) => item.id === work.id)) return false
    return persist({
      ...state.value,
      works: state.value.works.map((item) =>
        item.id === work.id ? { ...work, updatedAt: new Date().toISOString() } : item
      )
    })
  }
  function create(name: string, brief: string) {
    if (
      !workspaceId() ||
      readonly() ||
      error.value ||
      state.value.works.length >= 200 ||
      !name.trim()
    )
      return
    const work = { ...createWorkspaceWork(name), brief }
    if (persist({ version: 2, activeId: work.id, works: [work, ...state.value.works] })) return work
  }
  function createDraft(work: WorkspaceWork, kind: ProductionKind, name: string, brief: string) {
    const id = workspaceId()
    if (!id || readonly() || error.value || work.drafts.length >= 200 || !name.trim()) return
    try {
      const draft = { ...createProductionDraft(kind, name), brief }
      if (kind === 'image') {
        const images = createWorkImageDraftRepository(id, work.id, localStorage)
        const doc = createStudioDocument(name)
        doc.id = draft.id
        const index = images.loadIndex()
        if (!index) throw new Error('无法读取图片草稿列表')
        if (index.docs.length >= 100) return
        storageTransaction(
          localStorage,
          [
            workspaceWorksKey(id),
            workspaceImageIndexKey(id),
            workspaceImageDocumentKey(id, doc.id)
          ],
          () => {
            images.save(doc, {
              ...index,
              activeId: doc.id,
              docs: [...index.docs, { id: doc.id, name: doc.name, updatedAt: doc.updatedAt }]
            })
            const next = repository().load()
            repository().save({
              ...next,
              works: next.works.map((item) =>
                item.id === work.id
                  ? {
                      ...item,
                      drafts: item.drafts.map((existing) =>
                        existing.id === draft.id ? draft : existing
                      ),
                      lastTool: 'image'
                    }
                  : item
              )
            })
          }
        )
        refresh()
      } else if (
        !update({
          ...work,
          drafts: [...work.drafts, draft],
          activeDraftId: draft.id,
          lastTool: draftTool(kind)
        })
      )
        return
      return draft
    } catch {
      error.value = '创建草稿失败，请检查本机存储后重试。'
    }
  }
  function selectDraft(work: WorkspaceWork, draft: ProductionDraft) {
    if (readonly()) {
      work.activeDraftId = draft.id
      return true
    }
    return update({ ...work, activeDraftId: draft.id, lastTool: draftTool(draft.kind) })
  }
  function remove(work: WorkspaceWork) {
    return persist({
      ...state.value,
      activeId: state.value.activeId === work.id ? '' : state.value.activeId,
      works: state.value.works.filter((item) => item.id !== work.id)
    })
  }
  function storageChanged(event: StorageEvent) {
    if (
      event.key === workspaceWorksKey(workspaceId() ?? '') ||
      event.key === workspaceImageIndexKey(workspaceId() ?? '')
    ) {
      const activeId = state.value.activeId
      refresh()
      state.value.activeId = state.value.works.some((work) => work.id === activeId) ? activeId : ''
    }
  }
  onMounted(() => window.addEventListener('storage', storageChanged))
  onBeforeUnmount(() => window.removeEventListener('storage', storageChanged))
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
    refresh,
    select,
    update,
    create,
    createDraft,
    selectDraft,
    remove
  }
}
