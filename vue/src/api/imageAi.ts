import { axiosInst } from './index'

export type ImageAITask = 'description' | 'prompt' | 'tags'
export type ImageAIProvider = 'local' | 'local_gguf' | 'openrouter' | 'comfy_cloud'
export interface ComfyWorkflowNode { class_type: string; inputs: Record<string, unknown>; _meta?: {title?: string} }
export type ComfyWorkflow = Record<string, ComfyWorkflowNode>
export interface ImageAIPrompts { description: string; prompt: string; tags: string }
export interface ImageAIConfig {
  provider: ImageAIProvider
  openrouter_model: string
  gguf_base_url: string
  gguf_model: string
  comfy_model: string
  comfy_mode: 'router' | 'workflow'
  comfy_workflow: ComfyWorkflow | null
  comfy_workflow_name: string
  comfy_image_node_id: string
  comfy_image_input: string
  comfy_prompt_node_id: string
  comfy_prompt_input: string
  comfy_output_node_id: string
  prompts: ImageAIPrompts
  api_key_configured: boolean
  api_key_source: 'saved' | 'environment' | 'none'
  comfy_api_key_configured: boolean
  comfy_api_key_source: 'saved' | 'environment' | 'none'
}

export const DEFAULT_IMAGE_PROMPT_EN = 'Write an English image-generation prompt of at most {max_chars} characters that recreates the visible image. Describe subjects, composition, colors, lighting and style. Do not invent a model name, seed, sampler, artist name or details not visible. Output only the prompt.'
export const DEFAULT_IMAGE_PROMPT_ZH = '请用简体中文反推一段能够生成相近画面的提示词，最多{max_chars}个字符。描述可见主体、构图、颜色、光线与风格；不要编造模型名称、种子、采样器、艺术家或画面外的细节。只输出提示词正文。'
export const DEFAULT_IMAGE_DESCRIPTION = '请用简体中文客观描述这张图片的可见内容，最多{max_chars}个汉字。包括主要物体、场景、颜色和显著关系。不要猜测人物身份、地点、创作工具或图片之外的情节。只输出描述正文，不要标题。'
export const DEFAULT_IMAGE_TAGS = '从下列已有标签中挑选确实符合图片内容的标签，最多8个。只能使用列表中的原文。请只输出 JSON 字符串数组，不要解释。可选标签：{allowed_tags}'

export async function getImageAIConfig(): Promise<ImageAIConfig> {
  return (await axiosInst.value.get('/db/image-ai/config')).data
}

export async function saveImageAIConfig(config: Pick<ImageAIConfig, 'provider' | 'openrouter_model' | 'gguf_base_url' | 'gguf_model' | 'comfy_model' | 'comfy_mode' | 'comfy_workflow' | 'comfy_workflow_name' | 'comfy_image_node_id' | 'comfy_image_input' | 'comfy_prompt_node_id' | 'comfy_prompt_input' | 'comfy_output_node_id' | 'prompts'> & {api_key?: string; clear_api_key?: boolean; comfy_api_key?: string; clear_comfy_api_key?: boolean}): Promise<ImageAIConfig> {
  return (await axiosInst.value.put('/db/image-ai/config', config)).data
}

export async function getGGUFStatus(): Promise<{ready: boolean; models: string[]}> {
  return (await axiosInst.value.get('/db/image-ai/gguf/status', { timeout: 10000 })).data
}

export async function getComfyCloudStatus(): Promise<{ready: boolean; detail: string}> {
  return (await axiosInst.value.get('/db/image-ai/comfy/status', { timeout: 15000 })).data
}

export async function generateImageAIText(path: string, task: ImageAITask, max_chars = 120, allowed_tags: string[] = [], prompt_template?: string): Promise<{ task: ImageAITask; text: string; tags: string[] }> {
  return (await axiosInst.value.post('/db/image-ai/generate', { path, task, max_chars, allowed_tags, prompt_template }, { timeout: 300000 })).data
}
