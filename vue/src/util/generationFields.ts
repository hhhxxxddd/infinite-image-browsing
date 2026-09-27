export const generationParameterFields = [
  { key: 'Sampler', label: '采样器', placeholder: '例如 Euler a', kind: 'text' },
  { key: 'Schedule type', label: '调度器', placeholder: '例如 Karras', kind: 'text' },
  { key: 'Steps', label: '步数', placeholder: '例如 20', kind: 'integer', min: 1 },
  { key: 'CFG scale', label: '提示词引导', placeholder: '例如 7', kind: 'number', min: 0 },
  { key: 'Seed', label: '种子', placeholder: '例如 0，-1 表示随机', kind: 'integer', min: -1 },
  { key: 'Size', label: '生成尺寸', placeholder: '例如 1024x1024', kind: 'size' },
  { key: 'Clip skip', label: 'CLIP 跳过层', placeholder: '例如 2', kind: 'integer', min: 1 },
  { key: 'Denoising strength', label: '重绘幅度', placeholder: '0–1，例如 0.45', kind: 'number', min: 0, max: 1 },
  { key: 'Hires upscale', label: '放大倍数', placeholder: '例如 2', kind: 'number', min: 1 },
  { key: 'Hires steps', label: '高清修复步数', placeholder: '0 表示沿用步数', kind: 'integer', min: 0 },
] as const
export const generationResourceTypes = [
  { key: 'model', label: 'Checkpoint' }, { key: 'lora', label: 'LoRA' },
  { key: 'vae', label: 'VAE' }, { key: 'upscaler', label: 'Upscaler' },
  { key: 'embedding', label: 'Embedding' }, { key: 'controlnet', label: 'ControlNet' },
  { key: 'lyco', label: 'LyCORIS' }, { key: 'hypernet', label: 'Hypernetwork' },
]
export const generationFieldLabel = (key: string) => key === 'prompt' ? '正向提示词' : key === 'negativePrompt' ? '负向提示词' : key
export const generationFieldTooltip = (key: string) => {
  const chinese = key === 'prompt' ? '正向提示词' : key === 'negativePrompt' ? '负向提示词' : generationParameterFields.find(field => field.key === key)?.label
  return chinese && chinese !== generationFieldLabel(key) ? `${generationFieldLabel(key)} · ${chinese}` : generationFieldLabel(key)
}
export const generationResourceLabel = (key: string) => generationResourceTypes.find(type => type.key === key)?.label ?? key
export function validateGenerationParameter(key: string, value: string) {
  if (!value.trim()) return
  const field = generationParameterFields.find(field => field.key === key)
  if (!field || field.kind === 'text') return
  if (field.kind === 'size') {
    if (!/^([1-9]\d*)\s*[x×]\s*([1-9]\d*)$/.test(value.trim())) throw new Error('请填写正整数宽度和高度，例如 1024x1024')
    return
  }
  const number = Number(value)
  if (!Number.isFinite(number) || (field.kind === 'integer' && !Number.isSafeInteger(number)) || number < field.min || ('max' in field && number > field.max)) {
    throw new Error(`${field.label}格式不正确；${field.placeholder}`)
  }
}

export function generationNumberOptions(key: string) {
  const field = generationParameterFields.find(field => field.key === key)
  if (!field || (field.kind !== 'integer' && field.kind !== 'number')) return undefined
  return {
    min: field.min,
    max: 'max' in field ? field.max : field.kind === 'integer' ? Number.MAX_SAFE_INTEGER : undefined,
    integer: field.kind === 'integer',
    step: field.kind === 'integer' ? 1 : key === 'Denoising strength' ? 0.05 : 0.1,
  }
}
