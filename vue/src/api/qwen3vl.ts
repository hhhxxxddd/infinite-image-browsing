import { axiosInst } from './index'
import type { FileNodeInfo } from './files'
import type { SearchFilters } from './db'

export type QwenModelKind = 'embedding' | 'reranker' | 'instruct'
export type QwenModelSize = '2B' | '8B'
export type QwenQuantization = 'none' | 'int8' | 'nf4'
export type QwenModelOption = { size: QwenModelSize; model: string; installed: boolean; active: boolean; path: string }
export type QwenModelManager = {
  models: Record<QwenModelKind, QwenModelOption[]>
  job: { running: boolean; kind: QwenModelKind | ''; size: QwenModelSize | ''; stage: string; error: string }
  managed_dir: string
}
export type QwenStatus = {
  state: 'ready' | 'missing_model' | 'missing_dependency'
  detail: string
  model: string
  model_path: string
  quantization?: QwenQuantization
  config_source: 'settings' | 'environment'
  download_url: string
  image_count?: number
  indexed_count?: number
  running?: boolean
  processed?: number
  total?: number
  failed?: number
  error?: string
}
export type QwenResult = {
  files: (FileNodeInfo & { relevance: number; embedding_score: number; rerank_score?: number })[]
  checked: number
  partial: boolean
  mode: 'embedding' | 'rerank'
  candidate_limit: number
}

export async function getQwenStatus(kind: QwenModelKind): Promise<QwenStatus> {
  return (await axiosInst.value.get(`/db/qwen3-vl/${kind}/status`, { timeout: 15000 })).data
}

export async function getQwenModels(): Promise<QwenModelManager> {
  return (await axiosInst.value.get('/db/qwen-models', { timeout: 15000 })).data
}

export async function installQwenModel(kind: QwenModelKind, size: QwenModelSize): Promise<QwenModelManager> {
  return (await axiosInst.value.post('/db/qwen-models/install', { kind, size })).data
}

export async function selectQwenModel(kind: QwenModelKind, size: QwenModelSize): Promise<QwenModelManager> {
  return (await axiosInst.value.post('/db/qwen-models/select', { kind, size })).data
}

export async function saveQwenConfig(kind: QwenModelKind, model_path: string): Promise<void> {
  await axiosInst.value.put(`/db/qwen3-vl/${kind}/config`, { model_path })
}

export async function saveQwenInstructQuantization(mode: QwenQuantization): Promise<void> {
  await axiosInst.value.put('/db/qwen3-vl/instruct/quantization', { mode })
}

export async function startQwenIndex(): Promise<void> {
  await axiosInst.value.post('/db/qwen3-vl/embedding/index')
}

export async function searchQwen(query: string, filters: Partial<SearchFilters>, rerank: boolean): Promise<QwenResult> {
  return (await axiosInst.value.post('/db/qwen3-vl/search', { query, limit: 200, rerank, rerank_limit: 20, ...filters })).data
}

export type QwenGenerationTask = 'description' | 'prompt' | 'tags'
export const DEFAULT_QWEN_PROMPT_TEMPLATE_EN = 'Write an English image-generation prompt of at most {max_chars} characters that recreates the visible image. Describe subjects, composition, colors, lighting and style. Do not invent a model name, seed, sampler, artist name or details not visible. Output only the prompt.'
export const DEFAULT_QWEN_PROMPT_TEMPLATE_ZH = '请用简体中文反推一段能够生成相近画面的提示词，最多{max_chars}个字符。描述可见主体、构图、颜色、光线与风格；不要编造模型名称、种子、采样器、艺术家或画面外的细节。只输出提示词正文。'
export async function generateQwenImageText(path: string, task: QwenGenerationTask, max_chars = 120, allowed_tags: string[] = [], prompt_template?: string): Promise<{ task: QwenGenerationTask; text: string; tags: string[] }> {
  return (await axiosInst.value.post('/db/qwen3-vl/instruct/generate', { path, task, max_chars, allowed_tags, prompt_template }, { timeout: 300000 })).data
}

export async function getInferredPrompt(path: string): Promise<string> {
  return (await axiosInst.value.get('/db/image_ai_note', { params: { path } })).data.inferred_prompt
}

export async function saveInferredPrompt(path: string, inferred_prompt: string): Promise<string> {
  return (await axiosInst.value.put('/db/image_ai_note', { path, inferred_prompt })).data.inferred_prompt
}
