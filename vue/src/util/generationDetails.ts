import { getGenerationResources } from './generationResources.ts'

const formatValue = (value: unknown) => value == null || value === '' ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
export function generationDetails(meta: Record<string, any>, width?: number, height?: number) {
  const resources = getGenerationResources(meta)
  const extra = meta.extraJsonMetaInfo
  if (!resources.length && extra && typeof extra === 'object' && typeof extra.model === 'string') {
    resources.push({ type: 'API 模型', name: extra.model })
  }
  return {
    resources,
    primary: [
      ['Sampler', meta.sampler], ['Steps', meta.steps], ['CFG scale', meta.cfgScale],
      ['Seed', meta.seed], ['Size', meta.size || (meta.width && meta.height ? `${meta.width} × ${meta.height}` : '') ||
        (width && height ? `${width} × ${height}` : '')], ['Clip skip', meta.clipSkip]
    ].map(([key, value]) => ({ key: String(key), value: formatValue(value) })),
    more: Object.entries(meta)
      .filter(([key, value]) => !['prompt','negativePrompt','steps','sampler','cfgScale','seed','size','Size','width','height','clipSkip','Model','Model hash','LoRA','Lora','lora','Lora hashes','resources','hashes'].includes(key) && !key.startsWith('AddNet ') && value != null && value !== '')
      .map(([key, value]) => ({ key: key === 'extraJsonMetaInfo' ? '补充信息' : key, value: formatValue(value) }))
  }
}
