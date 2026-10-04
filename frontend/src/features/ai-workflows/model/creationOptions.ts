export const creationChoiceKey = 'omnigallery:studio-creation-choice-v1'

export const defaultCreationModels = [
  {
    id: 'vertexai/gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite'
  },
  {
    id: 'vertexai/gemini-3.1-flash-image',
    label: 'Nano Banana 2'
  },
  {
    id: 'vertexai/gemini-3-pro-image',
    label: 'Nano Banana Pro'
  },
  {
    id: 'bfl/flux-3-image',
    label: 'FLUX 3 Image'
  },
  {
    id: 'byteplus/seedream-5-0-260128',
    label: 'Seedream 5.0 · 260128'
  },
  {
    id: 'byteplus/seedream-5-0-pro-260628',
    label: 'Seedream 5.0 Pro · 260628'
  },
  {
    id: 'byteplus/seedream-5-0-flash-260915',
    label: 'Seedream 5.0 Flash · 260915'
  },
  {
    id: 'openai/gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare'
  },
  {
    id: 'openai/gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst'
  }
]

const options: Record<
  string,
  { aspect_ratios: string[]; image_sizes: string[]; reference_limit: number }
> = {
  'vertexai/gemini-3.1-flash-lite-image': {
    aspect_ratios: ['16:9', '1:1', '21:9', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16'],
    image_sizes: ['1K', '2K', '4K'],
    reference_limit: 13
  },
  'vertexai/gemini-3.1-flash-image': {
    aspect_ratios: [
      '16:9',
      '1:1',
      '21:9',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '9:16',
      '1:4',
      '1:8',
      '4:1',
      '8:1'
    ],
    image_sizes: ['1K', '2K', '4K'],
    reference_limit: 13
  },
  'vertexai/gemini-3-pro-image': {
    aspect_ratios: ['16:9', '1:1', '21:9', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16'],
    image_sizes: ['1K', '2K', '4K'],
    reference_limit: 13
  },
  'bfl/flux-3-image': {
    aspect_ratios: ['16:9', '1:1', '21:9', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16'],
    image_sizes: ['1K', '2K', '4K'],
    reference_limit: 9
  },
  'byteplus/seedream-5-0-260128': {
    aspect_ratios: ['16:9', '1:1', '21:9', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16'],
    image_sizes: ['2K', '3K'],
    reference_limit: 13
  },
  'byteplus/seedream-5-0-pro-260628': {
    aspect_ratios: ['16:9', '1:1', '21:9', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16'],
    image_sizes: ['1K', '2K'],
    reference_limit: 9
  },
  'byteplus/seedream-5-0-flash-260915': {
    aspect_ratios: ['16:9', '1:1', '21:9', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16'],
    image_sizes: ['1K', '1.5K', '2K'],
    reference_limit: 9
  },
  'openai/gpt-image-2.5-flare': {
    aspect_ratios: ['1:1', '3:2', '2:3'],
    image_sizes: ['1K'],
    reference_limit: 13
  },
  'openai/gpt-image-2.5-sunburst': {
    aspect_ratios: ['1:1', '3:2', '2:3'],
    image_sizes: ['1K'],
    reference_limit: 13
  }
}

export function routerAspectRatios(model: string): string[] {
  return options[model]?.aspect_ratios ?? []
}
export function routerImageSizes(model: string): string[] {
  return options[model]?.image_sizes ?? []
}
export function routerReferenceLimit(model: string): number {
  return options[model]?.reference_limit ?? 0
}
export function normalizeRouterChoice<
  T extends { model: string; aspectRatio: string; imageSize: string }
>(choice: T): T {
  const model = choice.model.startsWith('bfl/flux-2-')
    ? 'bfl/flux-3-image'
    : choice.model === 'vertexai/gemini-2.5-flash-image'
      ? 'vertexai/gemini-3.1-flash-image'
      : choice.model
  const sizes = routerImageSizes(model)
  return {
    ...choice,
    model,
    aspectRatio: routerAspectRatios(model).includes(choice.aspectRatio)
      ? choice.aspectRatio
      : 'auto',
    imageSize: sizes.includes(choice.imageSize) ? choice.imageSize : sizes[0] || '1K'
  }
}
