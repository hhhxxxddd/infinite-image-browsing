import { axiosInst } from '@/shared/api/httpClient'

export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AIChatRequest {
  messages: AIChatMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

export interface AIChatResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: AIChatMessage
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export const aiChat = async (req: AIChatRequest) => {
  const resp = await axiosInst.value.post('/ai-chat', req)
  return resp.data as AIChatResponse
}

// ========== Flatten Folder API ==========
