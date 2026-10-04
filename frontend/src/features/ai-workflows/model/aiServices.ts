export type AIMediaType = 'text' | 'image' | 'audio' | 'video'
export type AICapability = 'understanding' | 'generation' | 'editing' | 'processing'

export type AIModel = {
  id: string
  label: string
  service: string
  media: AIMediaType[]
  capabilities: AICapability[]
  enabled: boolean
  available: boolean | null
}

export type AIConnection = {
  configured: boolean
  source: 'saved' | 'environment' | 'none'
}

type CreationChoice = { mode: 'router' | 'workflow'; model: string }

export function resolveCreationDefault(
  purpose: 'image_generation' | 'image_edit',
  saved?: Partial<CreationChoice> | null,
  defaults?: Partial<Record<'image_generation' | 'image_edit', CreationChoice>> | null
): CreationChoice {
  return {
    mode:
      saved?.mode ||
      defaults?.[purpose]?.mode ||
      (purpose === 'image_edit' ? 'workflow' : 'router'),
    model: saved?.model || defaults?.[purpose]?.model || 'vertexai/gemini-3.1-flash-image'
  }
}
