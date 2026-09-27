import { generationParameterFields } from './generationFields.ts'
import { getGenerationResources } from './generationResources.ts'

const formatValue = (value: unknown) =>
  value == null || value === ''
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : String(value)
export function generationDetails(
  meta: Record<string, unknown>,
  width?: number,
  height?: number,
  includeMore = true
) {
  const resources = getGenerationResources(meta)
  const extra = meta.extraJsonMetaInfo
  if (
    !resources.length &&
    extra &&
    typeof extra === 'object' &&
    'model' in extra &&
    typeof extra.model === 'string'
  ) {
    resources.push({ type: 'API 模型', name: extra.model })
  }
  return {
    resources,
    primary: [
      ['Sampler', meta.sampler],
      ['Steps', meta.steps],
      ['CFG scale', meta.cfgScale],
      ['Schedule type', meta['Schedule type'] ?? meta.Scheduler],
      ['Denoising strength', meta['Denoising strength']],
      ['Hires upscale', meta['Hires upscale']],
      ['Hires steps', meta['Hires steps']],
      ['Seed', meta.seed],
      [
        'Size',
        meta.size ||
          (meta.width && meta.height ? `${meta.width} × ${meta.height}` : '') ||
          (width && height ? `${width} × ${height}` : '')
      ],
      ['Clip skip', meta.clipSkip]
    ].map(([key, value]) => ({ key: String(key), value: formatValue(value) })),
    more: !includeMore
      ? []
      : Object.entries(meta)
          .filter(
            ([key, value]) =>
              ![
                'prompt',
                'negativePrompt',
                'steps',
                'sampler',
                'cfgScale',
                'seed',
                'size',
                'Size',
                'width',
                'height',
                'clipSkip',
                'Model',
                'Model hash',
                'LoRA',
                'Lora',
                'lora',
                'Lora hashes',
                'resources',
                'hashes'
              ].includes(key) &&
              !generationParameterFields.some((field) => field.key === key) &&
              ![
                'VAE',
                'VAE hash',
                'Hires upscaler',
                'Upscaler',
                'Embedding',
                'ControlNet',
                'Scheduler'
              ].includes(key) &&
              !key.startsWith('AddNet ') &&
              value != null &&
              value !== ''
          )
          .map(([key, value]) => ({
            key: key === 'extraJsonMetaInfo' ? '补充信息' : key,
            value: formatValue(value)
          }))
  }
}
