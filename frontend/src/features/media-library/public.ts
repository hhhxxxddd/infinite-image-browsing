/** Public model and API contracts for media-library. UI entry points remain explicit to preserve lazy loading. */
export { getQuickMovePaths } from './model/recentLocations'
export { getFolderIcons } from './api/folderIcons'
export {
  downloadFiles,
  getFileTransferDataFromDragEvent,
  invalidateFileUrls,
  isAudioFile,
  isImageFile,
  isVideoFile,
  toImageThumbnailUrl,
  toImageUrl,
  toRawFileUrl,
  toStreamAudioUrl,
  toStreamVideoUrl,
  toVideoCoverUrl,
  uniqueFile
} from './model/mediaFiles'
export { addDroppedFolders, addToExtraPath } from './model/extraPathControlFunc'
export { useTagStore } from './model/useTagStore'
export type {
  ExtraPathModel,
  ExtraPathType,
  PickMediaType,
  SearchFilters,
  Tag
} from './api/library'
export type { FileNodeInfo, ImageEditRecord } from './api/files'
export {
  addCustomTag,
  buildMediaOutputEmbeddings,
  createTagGroup,
  deleteTagGroup,
  getDbBasicInfo,
  getImageDescription,
  getImagesBySubstr,
  getTagGroups,
  pickMedia,
  removeCustomTag,
  renameCustomTag,
  renameTagGroup,
  resolveMediaPaths,
  toggleCustomTagToImg,
  updateImageData,
  updateImageDescription,
  updateTag
} from './api/library'
export { chooseLocalDirectory, openWithAppPicker } from './api/fileOperations'
export {
  chooseLibraryDirectory,
  lastLibraryDirectory,
  validateLibraryDirectory
} from './model/libraryDirectoryDialog'
export { batchGetFilesInfo, deleteFiles, getImageEditHistory, saveComposedImage } from './api/files'
export { tagLabel } from './model/tagLabel'
export { audioCoverUrl, getAudioMetadata, updateAudioMetadata } from './api/audio'
export type { AudioMetadata } from './api/audio'
export { isAnimatedImage, mayBeAnimatedImage } from './model/mediaMotion'
export { groupTags } from './model/tagGroups'
export { openRebuildImageIndexModal } from './model/folderDialogs'

export type { Scroller } from './composables/folderBrowserContext'
