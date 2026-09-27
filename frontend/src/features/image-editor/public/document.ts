/** Pure document operations; independent of the renderer, stores, and HTTP clients. */
export {
  studioLayerVisible,
  createStudioDocument,
  readStudioDocument,
  readStudioIndex
} from '../model/imageStudioModel.ts'
export type { StudioDocument, StudioDocumentIndex } from '../model/imageStudioModel.ts'
export type { StudioDraftRepository } from '../model/studioDraftRepository.ts'
