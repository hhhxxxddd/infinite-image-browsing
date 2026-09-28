import type { StudioDraftRepository } from '../../image-editor/public/document.ts'
import { createWorkspaceDraftRepository } from './workspaceDraftRepository.ts'
import { createWorkImageDraftRepository, createWorkspaceWorksRepository } from './workspaceWorks.ts'

export function createPersistentImageDraftRepository(
  workspaceId: string,
  workId: string | undefined,
  storage: () => Storage,
  commit: (operation: (storage: Storage) => void) => Promise<void>
): StudioDraftRepository {
  const repository = (storage: Storage) =>
    workId
      ? createWorkImageDraftRepository(workspaceId, workId, storage)
      : createWorkspaceDraftRepository(workspaceId, storage)
  const observedIds = new Set<string>()
  let queue: Promise<unknown> = Promise.resolve()
  const observedDocuments = new Map<string, string | null>()
  const documentKey = (id: string) => `omnigallery:workbench-image-document-v2:${workspaceId}:${id}`
  return {
    loadIndex() {
      const index = repository(storage()).loadIndex()
      index?.docs.forEach((doc) => observedIds.add(doc.id))
      return index
    },
    loadDocument(id) {
      const doc = repository(storage()).loadDocument(id)
      if (doc) {
        observedIds.add(id)
        observedDocuments.set(id, storage().getItem(documentKey(id)))
      }
      return doc
    },
    save(document, index) {
      const run = queue.then(async () => {
        let savedValue: string | null = null
        await commit((storage) => {
          const key = documentKey(document.id)
          if (
            observedDocuments.has(document.id) &&
            storage.getItem(key) !== observedDocuments.get(document.id)
          )
            throw new Error('草稿已在其他窗口修改，请重新打开后继续编辑；本次修改尚未保存')
          if (workId && observedIds.has(document.id)) {
            const work = createWorkspaceWorksRepository(workspaceId, storage)
              .load()
              .works.find((work) => work.id === workId)
            if (!work?.drafts.some((draft) => draft.id === document.id))
              throw new Error('草稿已删除，请重新打开作品')
          }
          repository(storage).save(document, index)
          savedValue = storage.getItem(key)
        })
        // Failed writes do not mark a never-saved document as a deleted draft.
        observedIds.add(document.id)
        observedDocuments.set(document.id, savedValue)
      })
      queue = run.catch(() => {})
      return run
    },
    async remove(id) {
      await commit((storage) => {
        repository(storage).remove(id)
      })
    }
  }
}
