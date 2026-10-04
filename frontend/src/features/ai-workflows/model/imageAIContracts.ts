/** Framework-independent contracts shared by the React UI and domain models. */
export type ImageAITask = 'description' | 'prompt' | 'tags'

export type ImageAIProvider = 'local' | 'comfy_cloud'

export interface ComfyWorkflowNode {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: { title?: string }
}

export type ComfyWorkflow = Record<string, ComfyWorkflowNode>

export interface StudioWorkflowSlot {
  node_id: string
  input: string
}

export interface StudioOutputMapping {
  node_id: string
  label: string
}

export interface StudioWorkflowParameterOption {
  name: string
  values: string[]
}

export interface StudioWorkflowParameter {
  id: string
  name: string
  kind: 'number' | 'text' | 'boolean' | 'select'
  number_display?: 'input' | 'slider'
  targets: StudioWorkflowSlot[]
  options: StudioWorkflowParameterOption[]
  minimum: number | null
  maximum: number | null
  step: number | null
}

export const studioWorkflowPurposeLabels = {
  image_generation: '图片生成',
  image_edit: '图片编辑',
  audio_creation: '音频创作',
  video_creation: '视频创作'
} as const

export type StudioWorkflowPurpose = keyof typeof studioWorkflowPurposeLabels

export const workflowPurpose = (item: { purpose?: StudioWorkflowPurpose }): StudioWorkflowPurpose =>
  item.purpose ?? 'image_edit'

export interface StudioWorkflowPresetInput {
  name: string
  purpose: StudioWorkflowPurpose
  workflow: ComfyWorkflow
  image_node_id: string
  image_input: string
  mask_node_id: string
  mask_input: string
  mask_enabled?: boolean
  prompt_node_id: string
  prompt_input: string
  negative_prompt_node_id: string
  negative_prompt_input: string
  output_node_id: string
  output_mappings?: StudioOutputMapping[] | null
  reference_slots: StudioWorkflowSlot[]
  parameters: StudioWorkflowParameter[]
}

export interface StudioWorkflowPreset extends StudioWorkflowPresetInput {
  id: string
  created_at: number
  updated_at: number
}

export type StudioWorkflowSummary = Omit<
  StudioWorkflowPreset,
  'workflow' | 'image_input' | 'mask_input' | 'prompt_input' | 'negative_prompt_input'
> & {
  unavailable_reason?: string
  mask_from_image: boolean
  mask_reference_limit: number
  parameter_defaults: Record<string, (string | number | boolean)[]>
}

export interface ImageAIPrompts {
  description: string
  prompt: string
  tags: string
}

export interface ImageAIConfig {
  provider: ImageAIProvider
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
  comfy_api_key_configured: boolean
  comfy_api_key_source: 'saved' | 'environment' | 'none'
}

export type ImageAICreationMode = 'router' | 'workflow'

export interface ImageAICreationConfig {
  defaults: Record<'image_generation' | 'image_edit', { mode: ImageAICreationMode; model: string }>
  concurrency: number
  mode: ImageAICreationMode
  model: string
  comfy_api_key_configured: boolean
  comfy_api_key_source: 'saved' | 'environment' | 'none'
}

export const DEFAULT_IMAGE_PROMPT_EN =
  'Write an English image-generation prompt of at most {max_chars} characters that recreates the visible image. Describe subjects, composition, colors, lighting and style. Do not invent a model name, seed, sampler, artist name or details not visible. Output only the prompt.'

export const DEFAULT_IMAGE_PROMPT_ZH =
  '请用简体中文反推一段能够生成相近画面的提示词，最多{max_chars}个字符。描述可见主体、构图、颜色、光线与风格；不要编造模型名称、种子、采样器、艺术家或画面外的细节。只输出提示词正文。'

export const DEFAULT_IMAGE_DESCRIPTION =
  '请用简体中文客观描述这张图片的可见内容，最多{max_chars}个汉字。包括主要物体、场景、颜色和显著关系。不要猜测人物身份、地点、创作工具或图片之外的情节。只输出描述正文，不要标题。'

export const DEFAULT_IMAGE_TAGS =
  '从下列已有标签中挑选确实符合图片内容的标签，最多8个。只能使用列表中的原文。请只输出 JSON 字符串数组，不要解释。可选标签：{allowed_tags}'

export interface ComfyRouterModels {
  vision: { id: string; label: string }[]
  creation: { id: string; label: string }[]
}
