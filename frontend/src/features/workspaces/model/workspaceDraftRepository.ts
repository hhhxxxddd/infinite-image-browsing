import {
  readStudioDocument,
  readStudioIndex,
  type StudioDocumentIndex,
  type StudioDraftRepository
} from '../../image-editor/public/document.ts'

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
interface WorkspaceDraftRepository extends StudioDraftRepository {
  rename(id: string, name: string): void
  deleteEntry(id: string): void
}

/** Binding the workspace once keeps a pending save tied to its original workspace. */
export function createWorkspaceDraftRepository(
  workspaceId: string,
  storage: DraftStorage
): WorkspaceDraftRepository {
  const indexKey = workspaceImageIndexKey(workspaceId)
  const repository: WorkspaceDraftRepository = {
    loadIndex() {
      return readStudioIndex(
        JSON.parse(storage.getItem(workspaceImageIndexKey(workspaceId)) || 'null')
      )
    },
    loadDocument(id) {
      try {
        const document = readStudioDocument(
          JSON.parse(storage.getItem(workspaceImageDocumentKey(workspaceId, id)) || 'null')
        )
        return document?.id === id ? document : undefined
      } catch {
        return undefined
      }
    },
    save(document, index) {
      storage.setItem(workspaceImageDocumentKey(workspaceId, document.id), JSON.stringify(document))
      storage.setItem(workspaceImageIndexKey(workspaceId), JSON.stringify(index))
    },
    remove(id) {
      storage.removeItem(workspaceImageDocumentKey(workspaceId, id))
    },
    rename(id, name) {
      const index = repository.loadIndex()
      const document = repository.loadDocument(id)
      const normalizedName = name.trim().slice(0, 80)
      if (!normalizedName) throw new Error('请输入作品名称')
      if (!document || !index?.docs.some((item) => item.id === id))
        throw new Error('作品无法读取，请刷新后重试')
      if (document.name === normalizedName) return
      const updated = { ...document, name: normalizedName, updatedAt: new Date().toISOString() }
      const key = workspaceImageDocumentKey(workspaceId, id)
      const previous = storage.getItem(key) ?? JSON.stringify(document)
      storage.setItem(key, JSON.stringify(updated))
      try {
        storage.setItem(
          indexKey,
          JSON.stringify({
            ...index,
            docs: index.docs.map((item) =>
              item.id === id ? { id, name: updated.name, updatedAt: updated.updatedAt } : item
            )
          })
        )
      } catch (error) {
        storage.setItem(key, previous)
        throw error
      }
    },
    deleteEntry(id) {
      const index = repository.loadIndex()
      if (!index?.docs.some((item) => item.id === id)) throw new Error('作品不存在，请刷新后重试')
      const remaining = index.docs.filter((item) => item.id !== id)
      const previous = storage.getItem(indexKey) ?? JSON.stringify(index)
      storage.setItem(
        indexKey,
        JSON.stringify({
          ...index,
          docs: remaining,
          activeId: index.activeId === id ? (remaining[0]?.id ?? '') : index.activeId
        })
      )
      try {
        repository.remove(id)
      } catch (error) {
        storage.setItem(indexKey, previous)
        throw error
      }
    }
  }
  return repository
}

export const workspaceImageIndexKey = (workspaceId: string) =>
  `omnigallery:workbench-image-documents-v2:${workspaceId}`
export const workspaceImageDocumentKey = (workspaceId: string, docId: string) =>
  `omnigallery:workbench-image-document-v2:${workspaceId}:${docId}`
export function clearWorkspaceImageDrafts(
  workspaceId: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> &
    Partial<Pick<Storage, 'key' | 'length'>> = localStorage
) {
  let index: StudioDocumentIndex | undefined
  try {
    index = readStudioIndex(
      JSON.parse(storage.getItem(workspaceImageIndexKey(workspaceId)) || 'null')
    )
  } catch {
    /* Remove the index below. */
  }
  index?.docs.forEach((doc) => storage.removeItem(workspaceImageDocumentKey(workspaceId, doc.id)))
  const keyAt = storage.key?.bind(storage)
  if (keyAt && typeof storage.length === 'number') {
    const prefix = `omnigallery:workbench-image-document-v2:${workspaceId}:`
    const keys = Array.from({ length: storage.length }, (_, index) => keyAt(index)).filter(
      (key): key is string => !!key && key.startsWith(prefix)
    )
    keys.forEach((key) => storage.removeItem(key))
  }
  storage.removeItem(workspaceImageIndexKey(workspaceId))
}
