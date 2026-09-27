import type { StudioDocument, StudioDocumentIndex } from './imageStudioModel'

/** Host-owned persistence. The editor never constructs storage keys or selects a storage backend. */
export interface StudioDraftRepository {
  loadIndex(): StudioDocumentIndex | undefined
  loadDocument(id: string): StudioDocument | undefined
  save(document: StudioDocument, index: StudioDocumentIndex): void
  remove(id: string): void
}
