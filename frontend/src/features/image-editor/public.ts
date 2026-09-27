/** Public model and API contracts for image-editor. UI entry points remain explicit to preserve lazy loading. */
export {
  renderStudioDocument,
  renderStudioMask,
  studioImageDimensions
} from './model/imageStudioRender'
export {
  createGuideLayer,
  createImageLayer,
  createMaskLayer,
  createPaintLayer,
  createStudioDocument,
  readStudioDocument,
  readStudioIndex,
  scaleStudioDocument,
  studioLayerLocked,
  studioLayerVisible,
  studioMaskContainsPoint,
  studioMaskPaintBounds,
  studioMaskPoint
} from './model/imageStudioModel'
export type {
  StudioDocument,
  StudioDocumentIndex,
  StudioGuideLayer,
  StudioImageLayer,
  StudioMaskLayer,
  StudioPaintLayer,
  StudioPoint
} from './model/imageStudioModel'
export type { StudioRenderScope } from './model/imageStudioRender'
export type { ImageEditorProps, StudioArtifactRequest } from './model/imageEditorContract'

export type { StudioDraftRepository } from './model/studioDraftRepository'
export { studioDocumentRevision } from './model/studioPublication'
export { exportStudioBlob } from './model/studioExport'
export { studioExportDocument } from './model/imageStudioModel'
