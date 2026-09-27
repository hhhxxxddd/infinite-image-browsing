import {
  readStudioDocument,
  readStudioIndex,
  type StudioDocumentIndex,
  type StudioDraftRepository
} from '../../image-editor/public/document.ts'

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Binding the workspace once keeps a pending save tied to its original workspace. */
export function createWorkspaceDraftRepository(
  workspaceId: string,
  storage: DraftStorage
): StudioDraftRepository {
  return {
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
    }
  }
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
