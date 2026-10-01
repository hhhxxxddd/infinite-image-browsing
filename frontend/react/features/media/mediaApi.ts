import { apiFetch, apiRequest, apiUrl } from '../../shared/apiClient'
import type { StudioDocument } from '../../../src/features/image-editor/model/imageStudioModel'
import { completeMediaTagResults } from './mediaTagResults'
import { createRequestCoalescer } from '../../shared/requestCoalescer'

const metadataRequests = createRequestCoalescer()
const metadataRead = <T>(url: string) => metadataRequests.read(url, () => apiFetch<T>(url))
async function metadataWrite<T>(url: string, init: RequestInit, readUrl = url) {
  metadataRequests.forget(readUrl)
  try {
    return await apiFetch<T>(url, init)
  } finally {
    metadataRequests.forget(readUrl)
  }
}

export type MediaSection = 'all' | 'image' | 'video' | 'audio' | 'folders'

export interface MediaFile {
  id?: number
  name: string
  fullpath: string
  type: 'file' | 'dir'
  date: string
  created_time: string
  size: string
  bytes: number
  width?: number | null
  height?: number | null
  cover_url?: string
  cloud_only?: boolean
  workspace_artifact_id?: string
  edit_snapshot?: { owner: string; revision: string; asset: string }
}

export interface ImageEditRecord {
  id: string
  created_at: string
  updated_at: string
  overwrite: boolean
  source_path: string
  document: StudioDocument
  export_area: 'content' | 'canvas'
  asset_info: Record<string, MediaFile>
}

export interface FlattenFolderResult {
  success: boolean
  total_files: number
  conflicts: string[]
  moved_files: number
  errors: string[]
}

export interface MediaTag {
  id: number | string
  name: string
  display_name: string | null
  type: string
  color: string
  group_name: string
  count: number
}

export interface AudioMetadata {
  title: string
  embedded_title: string
  title_source: 'embedded' | 'filename'
  artist: string
  album: string
  duration: number | null
  has_cover: boolean
  cover_source: 'embedded' | 'same_name' | 'directory' | null
  cover_name: string
  editable: boolean
  revision: string
  modified_date: string
  lyrics: {
    source: 'sidecar' | 'embedded'
    timed: boolean
    lines: Array<{ time?: number; text: string }>
  } | null
}

export interface ArtifactMetadata {
  description: string
  generation_info: string
  embedded_generation_info: string
  inferred_prompt: string
  tag_ids: number[]
  exif: Record<string, string>
  source_image_available: boolean
}

export interface MediaFilters {
  and_tags: number[]
  or_tags: number[]
  not_tags: number[]
  exclude_all_tags: boolean
  tag_groups: Record<string, number[]>
  dimensions: {
    width?: number
    height?: number
    ratio_width?: number
    ratio_height?: number
  }
}

export interface LibraryRoot {
  path: string
  alias?: string
  types: string[]
}

export const emptyFilters = (): MediaFilters => ({
  and_tags: [],
  or_tags: [],
  not_tags: [],
  exclude_all_tags: false,
  tag_groups: {},
  dimensions: {}
})

const post = <T>(path: string, body: unknown, signal?: AbortSignal) =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body), signal })

export const getLibraryInfo = () =>
  apiFetch<{ media_count: number; tags: MediaTag[]; expired: boolean }>(
    '/basic_info?include_expiry=false'
  )

export const getExpiredDirectories = () =>
  apiFetch<{ expired: boolean; expired_dirs: string[] }>('/expired_dirs')

export const getLibraryRoots = () => apiFetch<LibraryRoot[]>('/extra_paths')

export const getFolderChildren = (path: string, directoriesOnly = true) =>
  apiFetch<{ files: MediaFile[] }>(
    `/files?${new URLSearchParams({ folder_path: path, directories_only: String(directoriesOnly) })}`
  )

export const getFolderIcons = () => apiFetch<Record<string, string>>('/folder-icons')

export const saveFolderIcon = (path: string, icon: string) =>
  apiFetch<{ path: string; icon: string }>('/folder-icons', {
    method: 'PUT',
    body: JSON.stringify({ path, icon })
  })

export const searchMedia = (
  args: {
    section: MediaSection
    query: string
    folderPath: string
    includeSubfolders: boolean
    filters: MediaFilters
    cursor: string
    size?: number
  },
  signal?: AbortSignal
) =>
  post<{ files: MediaFile[]; cursor: { has_next: boolean; next: string } }>(
    '/search_by_substr',
    {
      surstr: args.query,
      regexp: '',
      cursor: args.cursor,
      size: args.size ?? 100,
      manual_order: true,
      media_type: args.section === 'folders' ? 'all' : args.section,
      ...(args.folderPath
        ? { folder_path: args.folderPath, include_subfolders: args.includeSubfolders }
        : {}),
      ...args.filters
    },
    signal
  )

export interface SimilarResult {
  files: Array<MediaFile & { similarity: number }>
  checked: number
}

export interface VisualSearchResult {
  files: Array<MediaFile & { relevance: number }>
  checked: number
  partial: boolean
  mode: 'embedding' | 'rerank'
}

export interface VisualSearchStatus {
  state: 'ready' | 'missing_model' | 'missing_dependency'
  image_count?: number
  indexed_count?: number
  running?: boolean
  error?: string
  detail?: string
}

export const getVisualSearchStatus = () =>
  apiFetch<VisualSearchStatus>('/qwen3-vl/embedding/status')

export const getVisualRerankerStatus = () =>
  apiFetch<VisualSearchStatus>('/qwen3-vl/reranker/status')

export const startVisualSearchIndex = () => post<void>('/qwen3-vl/embedding/index', {})

export const searchByDescription = (
  query: string,
  filters: MediaFilters,
  folderPath: string,
  includeSubfolders: boolean,
  signal?: AbortSignal,
  rerank = false
) =>
  post<VisualSearchResult>(
    '/qwen3-vl/search',
    {
      query,
      limit: 200,
      rerank,
      ...filters,
      ...(folderPath ? { folder_path: folderPath, include_subfolders: includeSubfolders } : {})
    },
    signal
  )

export const searchSimilarMedia = (
  source: { path?: string; image_base64?: string },
  method: 'qwen' | 'hash',
  filters: MediaFilters,
  folderPath: string,
  includeSubfolders: boolean,
  signal?: AbortSignal
) =>
  post<SimilarResult>(
    '/similar_images',
    {
      ...source,
      method,
      minimum: 0,
      limit: 100,
      ...filters,
      ...(folderPath ? { folder_path: folderPath, include_subfolders: includeSubfolders } : {})
    },
    signal
  )

export const getMediaTags = async (paths: string[]) =>
  completeMediaTagResults(
    paths,
    await post<Record<string, MediaTag[]>>('/get_image_tags', { paths })
  )

export const getSelectedCustomTags = (path: string) =>
  apiFetch<MediaTag[]>(`/img_selected_custom_tag?${new URLSearchParams({ path })}`)

export const toggleMediaTag = (path: string, tagId: number) =>
  post<{ is_remove: boolean }>('/toggle_custom_tag_to_img', { img_path: path, tag_id: tagId })

/** One idempotent write, including retries after an interrupted response. */
export const setMediaCustomTags = (file: MediaFile, tagIds: string[], availableTags: MediaTag[]) =>
  file.workspace_artifact_id
    ? updateArtifactMetadata(file.workspace_artifact_id, { tag_ids: tagIds.map(Number) }).then(
        (metadata) => availableTags.filter((tag) => metadata.tag_ids.includes(Number(tag.id)))
      )
    : apiFetch<MediaTag[]>('/media_custom_tags', {
        method: 'PUT',
        body: JSON.stringify({ img_path: file.fullpath, tag_ids: tagIds.map(Number) })
      })

export const batchUpdateMediaTags = (paths: string[], action: 'add' | 'remove', tagId: number) =>
  post<void>('/batch_update_image_tag', { img_paths: paths, action, tag_id: tagId })

export const getReadOnlyMode = async () => {
  const settings = await apiFetch<{ is_readonly: boolean }>('/global_setting')
  return settings.is_readonly
}

export interface ArchiveSettings {
  directory: string
  custom_directory: string
  default_directory: string
}

export const getArchiveSettings = () => apiFetch<ArchiveSettings>('/archive_settings')

export const exportMediaArchive = async (paths: string[], compress: boolean, packOnly: boolean) => {
  const response = await apiRequest('/zip', {
    method: 'POST',
    body: JSON.stringify({ paths, compress, pack_only: packOnly })
  })
  return packOnly ? ((await response.json()) as { path: string }) : response.blob()
}

export const getMediaDescription = async (path: string) => {
  const result = await metadataRead<{ description: string }>(
    `/image_description?${new URLSearchParams({ path })}`
  )
  return result.description
}

export const updateMediaDescription = async (path: string, description: string) => {
  const result = await metadataWrite<{ description: string }>(
    '/image_description',
    {
      method: 'POST',
      body: JSON.stringify({ path, description })
    },
    `/image_description?${new URLSearchParams({ path })}`
  )
  return result.description
}

export const getGenerationInfo = (path: string) =>
  metadataRead<string>(`/image_geninfo?${new URLSearchParams({ path })}`)

export const updateGenerationInfo = (path: string, exif: string) =>
  metadataWrite<{ success: boolean }>(
    '/update_exif',
    {
      method: 'POST',
      body: JSON.stringify({ path, exif })
    },
    `/image_geninfo?${new URLSearchParams({ path })}`
  )

export const getMediaExif = (path: string) =>
  metadataRead<Record<string, string>>(`/image_exif?${new URLSearchParams({ path })}`)

export const getReferencePrompt = async (path: string) => {
  const result = await metadataRead<{ inferred_prompt: string }>(
    `/media_ai_note?${new URLSearchParams({ path })}`
  )
  return result.inferred_prompt
}

export const updateReferencePrompt = async (path: string, inferred_prompt: string) => {
  const result = await metadataWrite<{ inferred_prompt: string }>(
    '/media_ai_note',
    {
      method: 'PUT',
      body: JSON.stringify({ path, inferred_prompt })
    },
    `/media_ai_note?${new URLSearchParams({ path })}`
  )
  return result.inferred_prompt
}

export const getArtifactMetadata = (artifactId: string) =>
  metadataRead<ArtifactMetadata>(`/workspace_artifacts/${encodeURIComponent(artifactId)}/metadata`)

export const updateArtifactMetadata = (
  artifactId: string,
  updates: Partial<
    Pick<ArtifactMetadata, 'description' | 'generation_info' | 'inferred_prompt' | 'tag_ids'>
  >
) =>
  metadataWrite<ArtifactMetadata>(
    `/workspace_artifacts/${encodeURIComponent(artifactId)}/metadata`,
    {
      method: 'PUT',
      body: JSON.stringify(updates)
    }
  )

export const toggleArtifactTag = (artifactId: string, tagId: number) =>
  metadataWrite<{ is_remove: boolean }>(
    `/workspace_artifacts/${encodeURIComponent(artifactId)}/tags`,
    {
      method: 'POST',
      body: JSON.stringify({ tag_id: tagId })
    },
    `/workspace_artifacts/${encodeURIComponent(artifactId)}/metadata`
  )

export const getAudioMetadata = (path: string) =>
  metadataRead<AudioMetadata>(`/audio_metadata?${new URLSearchParams({ path })}`)

export const updateAudioMetadata = (request: {
  path: string
  revision: string
  title: string
  artist: string
  album: string
  cover?: string
  remove_cover?: boolean
}) =>
  metadataWrite<AudioMetadata>(
    '/audio_metadata',
    {
      method: 'POST',
      body: JSON.stringify(request)
    },
    `/audio_metadata?${new URLSearchParams({ path: request.path })}`
  )

export type ImageAiTextTask = 'description' | 'prompt' | 'tags'

export const getImageAiPrompts = async () => {
  const config = await apiFetch<{
    prompts: Record<ImageAiTextTask, string>
  }>('/image-ai/config')
  return config.prompts
}

export const generateImageAiText = (
  path: string,
  task: ImageAiTextTask,
  maxChars: number,
  allowedTags: string[] = [],
  promptTemplate?: string,
  signal?: AbortSignal
) =>
  post<{ task: ImageAiTextTask; text: string; tags: string[] }>(
    '/image-ai/generate',
    {
      path,
      task,
      max_chars: maxChars,
      allowed_tags: allowedTags,
      ...(promptTemplate ? { prompt_template: promptTemplate } : {})
    },
    signal
  )

export const scanLibrary = () => post<void>('/update_image_data', {})

export const getExpiredDirs = () =>
  apiFetch<{ expired: boolean; expired_dirs: string[] }>('/expired_dirs')

export const getFolderPickerPath = async () => {
  const result = await post<{ path: string | null }>('/choose_local_directory', {})
  return result.path
}

export const addLibraryRoot = (path: string) =>
  post<void>('/extra_paths', { path, types: ['walk'] })

export const removeLibraryRoot = (root: LibraryRoot) =>
  apiFetch<void>('/extra_paths', {
    method: 'DELETE',
    body: JSON.stringify({ path: root.path, types: root.types })
  })

export const aliasLibraryRoot = (path: string, alias: string) =>
  post<void>('/alias_extra_path', { path, alias })

export const createFolder = (path: string) => post<void>('/mkdirs', { dest_folder: path })

export const renameMediaFile = (path: string, name: string) =>
  post<{ new_path: string }>('/rename', { path, name })

export const renameFolder = (path: string, name: string) =>
  post<{ new_path: string }>('/rename_folder', { path, name })

export const swapMediaOrder = (source: string, target: string) =>
  post<{ ok: true }>('/media_order/swap', { source, target })

export const resetMediaOrder = () => apiFetch<{ ok: true }>('/media_order', { method: 'DELETE' })

export const deleteMediaFiles = (paths: string[]) =>
  post<{ ok: true }>('/delete_files', { file_paths: paths })

export const checkFolderPath = async (path: string) => {
  const result = await post<Record<string, boolean>>('/check_path_is_directory', { paths: [path] })
  return !!result[path]
}

export const checkDirectoryPaths = (paths: string[]) =>
  post<Record<string, boolean>>('/check_path_is_directory', { paths })

export const flattenFolder = (path: string, dryRun = true) =>
  post<FlattenFolderResult>('/flatten_folder', { folder_path: path, dry_run: dryRun })

export const openWithAppPicker = (path: string) => post<void>('/open_with_app_picker', { path })

export const isEditableOriginalImage = (file: MediaFile) =>
  !file.cloud_only &&
  !file.workspace_artifact_id &&
  /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(file.name)

export const isAnimatedMedia = async (file: MediaFile) => {
  if (!/\.(png|webp)$/i.test(file.name)) return false
  const result = await apiFetch<{ animated: boolean }>(
    `/media_motion?${new URLSearchParams({ path: file.fullpath })}`
  )
  return result.animated
}

export const getImageEditHistory = (path: string, revision?: string) =>
  apiFetch<{ record: ImageEditRecord | null }>(
    `/image_edit_history?${new URLSearchParams({ path, ...(revision ? { revision } : {}) })}`
  )

export const saveComposedImage = (input: {
  path: string
  width: number
  height: number
  rendered_base64: string
  overwrite: boolean
  editor_document: StudioDocument
  export_area: 'content' | 'canvas'
  parent_revision?: string
}) =>
  post<{ file: MediaFile; record: ImageEditRecord }>('/edit_image', {
    ...input,
    crop: { x: 0, y: 0, width: 1, height: 1 }
  })

export const checkPathsExist = (paths: string[]) =>
  post<Record<string, boolean>>('/check_path_exists', { paths })

export const transferMediaFiles = (mode: 'move' | 'copy', paths: string[], destination: string) =>
  post<{ files: MediaFile[]; errors?: string[] }>(mode === 'move' ? '/move_files' : '/copy_files', {
    file_paths: paths,
    dest: destination,
    create_dest_folder: false,
    continue_on_error: false
  })

export const openContainingFolder = (path: string) => post<void>('/open_folder', { path })

export const thumbnailUrl = (file: MediaFile, size = 512): string => {
  const snapshot = file.edit_snapshot
  if (snapshot) {
    return apiUrl(
      `/image_edit_asset?${new URLSearchParams({
        path: snapshot.owner,
        revision: snapshot.revision,
        asset: snapshot.asset
      })}`
    )
  }
  if (file.workspace_artifact_id) {
    return apiUrl(
      `/workspace_artifacts/${encodeURIComponent(file.workspace_artifact_id)}/thumbnail?size=${size}`
    )
  }
  return apiUrl(
    `/image-thumbnail?${new URLSearchParams({
      path: file.fullpath,
      size: `${size}x${size}`,
      fit: 'short',
      v: '3',
      t: file.date || ''
    })}`
  )
}

export const rawMediaUrl = (file: MediaFile, download = false): string => {
  const snapshot = file.edit_snapshot
  if (snapshot) {
    return apiUrl(
      `/image_edit_asset?${new URLSearchParams({
        path: snapshot.owner,
        revision: snapshot.revision,
        asset: snapshot.asset
      })}`
    )
  }
  if (file.workspace_artifact_id) {
    return apiUrl(
      `/workspace_artifacts/${encodeURIComponent(file.workspace_artifact_id)}/file${download ? '?download=true' : ''}`
    )
  }
  return apiUrl(
    `/file?${new URLSearchParams({
      path: file.fullpath,
      t: file.date || '',
      ...(download ? { disposition: file.name } : {})
    })}`
  )
}

export const videoCoverUrl = (file: MediaFile) =>
  file.cover_url ||
  apiUrl(`/video_cover?${new URLSearchParams({ path: file.fullpath, mt: file.date || '' })}`)

export const audioCoverUrl = (file: MediaFile) =>
  apiUrl(`/audio_cover?${new URLSearchParams({ path: file.fullpath, t: file.date || '' })}`)

export const streamMediaUrl = (file: MediaFile) =>
  file.workspace_artifact_id
    ? rawMediaUrl(file)
    : apiUrl(`/stream_video?${new URLSearchParams({ path: file.fullpath })}`)

export const mediaKind = (file: MediaFile): 'image' | 'video' | 'audio' | 'other' => {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  if (/^(jpe?g|png|gif|webp|avif|bmp|svg|tiff?|heic|heif)$/.test(extension)) return 'image'
  if (/^(mp4|mkv|mov|webm|avi|m4v|wmv|flv|ts)$/.test(extension)) return 'video'
  if (/^(mp3|m4a|aac|wav|flac|ogg|opus|wma|aiff?)$/.test(extension)) return 'audio'
  return 'other'
}
