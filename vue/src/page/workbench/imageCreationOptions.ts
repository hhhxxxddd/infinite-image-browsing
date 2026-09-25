export const creationChoiceKey = 'iib-studio-creation-choice-v1'

export const defaultCreationModels = [
  { id: 'vertexai/gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite' },
  { id: 'vertexai/gemini-3.1-flash-image', label: 'Nano Banana 2' },
  { id: 'vertexai/gemini-3-pro-image', label: 'Nano Banana Pro' },
  { id: 'vertexai/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
]

export const resizableCreationModels = ['vertexai/gemini-3.1-flash-image', 'vertexai/gemini-3-pro-image']

const commonAspectRatios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const flashExtraAspectRatios = ['1:4', '4:1', '1:8', '8:1']

export function routerAspectRatios(model: string): string[] {
  return model === 'vertexai/gemini-3.1-flash-image'
    ? [...commonAspectRatios, ...flashExtraAspectRatios] : commonAspectRatios
}
