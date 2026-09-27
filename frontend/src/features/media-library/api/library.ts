import { ref } from 'vue'
import { Dict } from '@/shared/types/common'
import type { FileNodeInfo } from './files'
import { axiosInst } from '@/shared/api/httpClient'
import { PageCursor } from 'vue3-ts-util'
import type { MediaPath } from '@/features/workspaces/public'

export async function resolveMediaPaths(ids: number[]): Promise<MediaPath[]> {
  const result: MediaPath[] = []
  const unique = [...new Set(ids)]
  for (let start = 0; start < unique.length; start += 500) {
    const response = await axiosInst.value.post('/media-paths', {
      ids: unique.slice(start, start + 500)
    })
    result.push(...response.data)
  }
  return result
}

export interface Tag {
  name: string
  id: number | string
  display_name: string | null
  type: string
  color: string
  group_name: string
  count: number
}

export type MediaLibraryInfo = {
  media_count: number
  tags: Tag[]
  expired: boolean
  expired_dirs: string[]
}

export const getDbBasicInfo = async (includeExpiry = true) => {
  const resp = await axiosInst.value.get('/basic_info', {
    params: { include_expiry: includeExpiry }
  })
  return resp.data as MediaLibraryInfo
}

export const getExpiredDirs = async () => {
  const resp = await axiosInst.value.get('/expired_dirs')
  return resp.data as Pick<MediaLibraryInfo, 'expired' | 'expired_dirs'>
}

export const indexScanning = ref(false)
let pendingScan: Promise<void> | undefined
export const updateImageData = (): Promise<void> => {
  if (pendingScan) return pendingScan
  indexScanning.value = true
  pendingScan = axiosInst.value
    .post('/update_image_data', {}, { timeout: Infinity })
    .then(() => {})
    .finally(() => {
      indexScanning.value = false
      pendingScan = undefined
    })
  return pendingScan
}

export const updateTag = async (
  tag: Pick<Tag, 'id'> & Partial<Pick<Tag, 'color' | 'group_name'>>
) => {
  const resp = await axiosInst.value.post('/update_tag', tag)
  return resp.data as Tag
}

export const getTagGroups = async () => {
  const resp = await axiosInst.value.get('/tag_groups')
  return resp.data as string[]
}
export const createTagGroup = async (name: string) => {
  const resp = await axiosInst.value.post('/create_tag_group', { name })
  return resp.data as string[]
}
export const renameTagGroup = async (name: string, new_name: string) => {
  const resp = await axiosInst.value.post('/rename_tag_group', { name, new_name })
  return resp.data as string[]
}
export const deleteTagGroup = async (name: string) => {
  const resp = await axiosInst.value.post('/delete_tag_group', { name })
  return resp.data as string[]
}

export const renameCustomTag = async (id: number | string, name: string) => {
  const resp = await axiosInst.value.post('/rename_custom_tag', { id, name })
  return resp.data as Tag
}

export type TagId = number | string

export interface ImageSizeFilter {
  width?: number | null
  height?: number | null
  ratio_width?: number | null
  ratio_height?: number | null
}

export interface SearchFilters {
  folder_path?: string
  include_subfolders?: boolean
  and_tags: TagId[]
  or_tags: TagId[]
  not_tags: TagId[]
  exclude_all_tags?: boolean
  /** Match any tag within each category, and every selected category. */
  tag_groups?: Record<string, TagId[]>
  dimensions: ImageSizeFilter
}

export const addCustomTag = async (req: { tag_name: string; group_name?: string }) => {
  const resp = await axiosInst.value.post('/add_custom_tag', req)
  return resp.data as Tag
}

export const toggleCustomTagToImg = async (req: { tag_id: TagId; img_path: string }) => {
  const resp = await axiosInst.value.post('/toggle_custom_tag_to_img', req)
  return resp.data as { is_remove: boolean }
}

export const removeCustomTag = async (req: { tag_id: TagId }) => {
  await axiosInst.value.post('/remove_custom_tag', req)
}

export const getImageSelectedCustomTag = async (path: string) => {
  const resp = await axiosInst.value.get('/img_selected_custom_tag', { params: { path } })
  return resp.data as Tag[]
}

export type PickMediaType = 'all' | 'image' | 'video' | 'audio'
export const pickMedia = async (
  mediaType: PickMediaType,
  excludePaths: string[] = [],
  limit = 24
) => {
  const resp = await axiosInst.value.post('/pick_media', {
    media_type: mediaType,
    exclude_paths: excludePaths,
    limit
  })
  return resp.data as FileNodeInfo[]
}

export interface SearchBySubstrReq extends Partial<SearchFilters> {
  manual_order?: boolean
  surstr: string
  cursor: string
  regexp: string
  filename_only?: boolean
  folder_paths?: string[]
  size?: number
  media_type?: string // "all", "image", "video"
}

export const getImagesBySubstr = async (req: SearchBySubstrReq) => {
  const resp = await axiosInst.value.post('/search_by_substr', req)
  return resp.data as {
    files: FileNodeInfo[]
    cursor: PageCursor
  }
}

export const getImageDescription = async (path: string) => {
  const resp = await axiosInst.value.get('/image_description', { params: { path } })
  return resp.data as { description: string }
}

export const updateImageDescription = async (path: string, description: string) => {
  const resp = await axiosInst.value.post('/image_description', { path, description })
  return resp.data as { description: string }
}

const extraPaths = '/extra_paths'
export type ExtraPathType = 'scanned' | 'walk' | 'cli_access_only' | '' | 'scanned-fixed'

export interface ExtraPathModel {
  path: string
  alias?: string
  types: ExtraPathType[]
}

export const getExtraPath = async () => {
  const resp = await axiosInst.value.get(extraPaths)
  return resp.data as ExtraPathModel[]
}

export const addExtraPath = async (model: ExtraPathModel) => {
  await axiosInst.value.post(extraPaths, model)
}
export const removeExtraPath = async (req: ExtraPathModel) => {
  await axiosInst.value.delete(extraPaths, { data: req })
}

export interface ExtraPathAliasModel {
  path: string
  alias: string
}

export const aliasExtraPath = async (model: ExtraPathAliasModel) => {
  await axiosInst.value.post('/alias_extra_path', model)
}

export const batchGetTagsByPath = async (paths: string[]) => {
  const resp = await axiosInst.value.post('/get_image_tags', { paths })
  return resp.data as Dict<Tag[]>
}

export const rebuildImageIndex = () => axiosInst.value.post('/rebuild_index')

export interface BatchUpdateTagParams {
  img_paths: string[]
  action: 'add' | 'remove'
  tag_id: number
}

export const batchUpdateImageTag = (data: BatchUpdateTagParams) => {
  return axiosInst.value.post('/batch_update_image_tag', data)
}

export interface RenameFileParams {
  path: string
  name: string
}

export const renameFile = async (data: RenameFileParams) => {
  const resp = await axiosInst.value.post('/rename', data)
  return resp.data as Promise<{ new_path: string }>
}

export const renameFolder = async (data: RenameFileParams) => {
  const resp = await axiosInst.value.post<{ new_path: string }>('/rename_folder', data)
  return resp.data
}

// ===== Natural language topic clustering =====
export interface BuildMediaOutputEmbeddingsReq {
  folder?: string
  model?: string
  force?: boolean
  batch_size?: number
  max_chars?: number
  /** If true, include files in subfolders. Default true for backward compatibility. */
  recursive?: boolean
}

export interface BuildMediaOutputEmbeddingsResp {
  folder: string
  count: number
  updated: number
  skipped: number
  model: string
}

export const buildMediaOutputEmbeddings = async (req: BuildMediaOutputEmbeddingsReq) => {
  const resp = await axiosInst.value.post('/build_media_output_embeddings', req)
  return resp.data as BuildMediaOutputEmbeddingsResp
}

export interface ClusterMediaOutputReq {
  folder?: string
  folder_paths?: string[]
  model?: string
  force_embed?: boolean
  threshold?: number
  batch_size?: number
  max_chars?: number
  min_cluster_size?: number
  lang?: string
  // advanced (backend-supported; optional)
  force_title?: boolean
  use_title_cache?: boolean
  assign_noise_threshold?: number
}

export interface ClusterMediaOutputResp {
  folder: string
  model: string
  threshold: number
  min_cluster_size: number
  count: number
  clusters: Array<{
    id: string
    title: string
    size: number
    paths: string[]
    sample_prompt: string
  }>
  noise: string[]
}

// ===== Async clustering job (progress polling) =====
export interface ClusterMediaOutputJobStartResp {
  job_id: string
}

export interface ClusterMediaOutputJobStatusResp {
  job_id: string
  status: 'queued' | 'running' | 'done' | 'error'
  stage?: string
  folders?: string[]
  progress?: {
    // embedding totals
    scanned?: number
    to_embed?: number
    embedded_done?: number
    updated?: number
    skipped?: number
    folder?: string
    // clustering
    items_total?: number
    items_done?: number
    // titling
    clusters_total?: number
    clusters_done?: number
  }
  error?: string
  result?: ClusterMediaOutputResp
}

export const startClusterMediaOutputJob = async (req: ClusterMediaOutputReq) => {
  const resp = await axiosInst.value.post('/cluster_media_output_job_start', req)
  return resp.data as ClusterMediaOutputJobStartResp
}

export const getClusterMediaOutputJobStatus = async (job_id: string) => {
  const resp = await axiosInst.value.get('/cluster_media_output_job_status', {
    params: { job_id }
  })
  return resp.data as ClusterMediaOutputJobStatusResp
}

export interface ClusterMediaOutputCachedResp {
  cache_key: string
  cache_hit: boolean
  cached_at?: string
  stale: boolean
  stale_reason?: {
    folders_changed?: boolean
    reason?: string
    path?: string
    stored?: string
    current?: string
    embeddings_changed?: boolean
    embeddings_count?: number
    embeddings_max_updated_at?: string
  }
  result?: ClusterMediaOutputResp | null
}

export const getClusterMediaOutputCached = async (req: ClusterMediaOutputReq) => {
  const resp = await axiosInst.value.post('/cluster_media_output_cached', req)
  return resp.data as ClusterMediaOutputCachedResp
}

// ===== Natural language prompt query (RAG-like retrieval) =====
export interface PromptSearchReq {
  query: string
  folder?: string
  folder_paths?: string[]
  model?: string
  top_k?: number
  min_score?: number
  ensure_embed?: boolean
  max_chars?: number
}

export interface PromptSearchResp {
  query: string
  folder: string
  model: string
  count: number
  top_k: number
  results: Array<{
    id: number
    path: string
    score: number
    sample_prompt: string
  }>
}

export const searchMediaOutputByPrompt = async (req: PromptSearchReq) => {
  const resp = await axiosInst.value.post('/search_media_output_by_prompt', req, {
    timeout: Infinity
  })
  return resp.data as PromptSearchResp
}

// ===== Hierarchical Tag Graph =====
export interface TagGraphReq {
  folder_paths: string[]
  lang?: string
}

export interface LayerNode {
  id: string
  label: string
  size: number
  metadata?: {
    type: string
    image_count?: number
    cluster_count?: number
    level?: number
  }
}

export interface GraphLayer {
  level: number
  name: string
  nodes: LayerNode[]
}

export interface GraphLink {
  source: string
  target: string
  weight: number
}

export interface TagGraphResp {
  layers: GraphLayer[]
  links: GraphLink[]
  stats: {
    total_clusters: number
    selected_clusters: number
    total_tags: number
    selected_tags: number
    abstraction_layers: number
    total_links: number
    topic_cluster_cache_key?: string
  }
}

export const getClusterTagGraph = async (req: TagGraphReq) => {
  // Large datasets can take longer to build / transfer; keep a generous timeout.
  const resp = await axiosInst.value.post('/cluster_tag_graph', req, { timeout: 300000 })
  return resp.data as TagGraphResp
}

export interface TagGraphClusterPathsReq {
  topic_cluster_cache_key: string
  cluster_id: string
}

export interface TagGraphClusterPathsResp {
  paths: string[]
}

export const getClusterTagGraphClusterPaths = async (req: TagGraphClusterPathsReq) => {
  const resp = await axiosInst.value.post('/cluster_tag_graph_cluster_paths', req, {
    timeout: 300000
  })
  return resp.data as TagGraphClusterPathsResp
}

export const swapMediaOrder = async (source: string, target: string) => {
  await axiosInst.value.post('/media_order/swap', { source, target })
}
export const resetMediaOrder = async () => {
  await axiosInst.value.delete('/media_order')
}
