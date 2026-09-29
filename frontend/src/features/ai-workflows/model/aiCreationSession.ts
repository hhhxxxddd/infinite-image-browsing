import type { AICreationSection } from '../../workspaces/model/workspaceMaterials'

export type AICreationMedia = 'image' | 'audio' | 'video'
export type AIImageTask = 'generation' | 'edit'
export const aiCreationMedia = [
  { id: 'image', label: 'AI 图片' },
  { id: 'audio', label: 'AI 音频' },
  { id: 'video', label: 'AI 视频' }
] as const
export interface AICreationSession {
  version: 1
  section: AICreationSection
  imageTask: AIImageTask
}
export const aiCreationSessionKey = (workspaceId: string, scope: string) =>
  `omnigallery:ai-production-session-v1:${workspaceId}:${scope}`

/** Legacy purpose selects the initial task; it does not restrict the production file. */
export function readAICreationSession(
  storage: Pick<Storage, 'getItem'>,
  workspaceId: string,
  scope: string,
  purpose?: 'image_edit' | 'image_generation'
): AICreationSession {
  const imageTask = purpose === 'image_generation' ? 'generation' : 'edit'
  const fallback: AICreationSession = { version: 1, section: imageTask, imageTask }
  try {
    const saved = JSON.parse(storage.getItem(aiCreationSessionKey(workspaceId, scope)) ?? 'null')
    if (
      saved?.version !== 1 ||
      !['generation', 'edit', 'audio', 'video'].includes(saved.section) ||
      !['generation', 'edit'].includes(saved.imageTask)
    )
      return fallback
    // An image section is authoritative when reading an inconsistent older snapshot.
    return {
      version: 1,
      section: saved.section,
      imageTask: ['generation', 'edit'].includes(saved.section) ? saved.section : saved.imageTask
    }
  } catch {
    return fallback
  }
}
export function aiSessionMedia(session: AICreationSession): AICreationMedia {
  return session.section === 'audio' || session.section === 'video' ? session.section : 'image'
}
export function selectAIMedia(
  session: AICreationSession,
  media: AICreationMedia
): AICreationSession {
  return { ...session, section: media === 'image' ? session.imageTask : media }
}
export function selectAIImageTask(
  session: AICreationSession,
  task: AIImageTask
): AICreationSession {
  return { ...session, section: task, imageTask: task }
}
