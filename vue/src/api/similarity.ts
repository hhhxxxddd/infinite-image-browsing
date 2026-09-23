import { axiosInst } from './index'
import type { FileNodeInfo } from './files'
import type { SearchFilters } from './db'

export interface SimilarImage extends FileNodeInfo { similarity: number }
export interface SimilarityResult {
  files: SimilarImage[]
  matched: number
  checked: number
  skipped: number
  cached: number
  method?: 'qwen' | 'hash'
}
export async function searchSimilarImages(query: Partial<SearchFilters> & {image_base64?: string; path?: string; minimum: number; method: 'qwen' | 'hash'}, signal?: AbortSignal) {
  const response = await axiosInst.value.post<SimilarityResult>('/db/similar_images', {...query, limit: 100}, {timeout: 0, signal})
  return response.data
}
