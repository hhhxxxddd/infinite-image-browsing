import type { WorkspaceArtifact } from '../api/workspaceArtifacts'

const sourceLabels: Record<WorkspaceArtifact['source'], readonly string[]> = {
  ai_image_edit: ['AI 生成', '图片编辑'],
  ai_image_generation: ['AI 生成', '图片生成'],
  image_studio: ['图片制作'],
  audio_studio: ['音频制作']
}

export function workspaceArtifactSourceLabels(
  source?: WorkspaceArtifact['source']
): readonly string[] {
  return source ? (sourceLabels[source] ?? ['工作区产物']) : ['工作区产物']
}
