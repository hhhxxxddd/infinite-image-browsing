import type { FileNodeInfo } from '@/shared/types/fileNode'
import type { WorkspaceArtifactMetadata } from '@/features/workspaces/model/workspaceArtifactTypes'

export interface AssetPreviewMetadata {
  generationInfo: string
  embeddedGenerationInfo: string
  description: string
  inferredPrompt: string
  exif: Record<string, string>
  sourceImageAvailable: boolean
}

export interface AssetPreviewMetadataLoaders {
  artifact: (id: string) => Promise<WorkspaceArtifactMetadata>
  library: (path: string, kind: 'image' | 'video' | 'audio') => Promise<AssetPreviewMetadata>
}

export async function loadAssetPreviewMetadata(
  file: FileNodeInfo | undefined,
  kind: 'image' | 'video' | 'audio',
  loaders: AssetPreviewMetadataLoaders
): Promise<AssetPreviewMetadata | undefined> {
  if (!file || file.cloud_only) return undefined
  if (file.workspace_artifact_id) {
    const data = await loaders.artifact(file.workspace_artifact_id)
    return {
      generationInfo: data.generation_info,
      embeddedGenerationInfo: data.embedded_generation_info,
      description: data.description,
      inferredPrompt: data.inferred_prompt,
      exif: data.exif,
      sourceImageAvailable:
        kind === 'image' && !file.workspace_input_owner && data.source_image_available
    }
  }
  if (!file.fullpath || file.edit_snapshot) return undefined
  return loaders.library(file.fullpath, kind)
}
