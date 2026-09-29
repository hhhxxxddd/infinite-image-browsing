import type { FileNodeInfo } from '@/features/media-library/public'
import {
  createStudioDocument,
  createImageLayer,
  renderStudioDocument,
  studioImageDimensions,
  type StudioDocument
} from '@/features/image-editor/public'
import {
  prepareAIInput,
  installAIBranch,
  createBranchDocument,
  type AIInputScope
} from '../model/aiProductionBranch'
import {
  saveWorkspaceInput,
  deleteWorkspaceArtifact,
  type WorkspaceArtifact
} from '../api/workspaceArtifacts'
import { saveWorkspaceState, reloadWorkspaceStorage, workspaceStorage } from './workspaceStorage'
import { createWorkspaceWorksRepository } from '../model/workspaceWorks'

export async function createAIBranch(
  workspaceId: string,
  workId: string,
  source: StudioDocument,
  scope: AIInputScope,
  area: 'content' | 'canvas',
  label: string,
  maskIds: string[],
  referencePaths: string[],
  assetInfo: Record<string, FileNodeInfo>
) {
  const productionId = crypto.randomUUID()
  const saved: WorkspaceArtifact[] = []
  let installing = false
  async function snapshot(doc: StudioDocument, name: string) {
    const canvas = document.createElement('canvas')
    const errors = await renderStudioDocument(canvas, doc, assetInfo, false)
    if (errors.length) throw new Error(`无法读取输入图片：${errors.join('、')}`)
    const artifact = await saveWorkspaceInput(
      workspaceId,
      productionId,
      name.slice(0, 110),
      canvas.toDataURL('image/png').split(',')[1]
    )
    saved.push(artifact)
    return `workspace-artifact:${artifact.id}`
  }
  try {
    const input = prepareAIInput(source, scope, area, maskIds)
    const inputPath = await snapshot(input, source.name)
    const references: { path: string; originalPath: string; doc: StudioDocument }[] = []
    for (const originalPath of [...new Set(referencePaths)].slice(0, 13)) {
      const file = assetInfo[originalPath]
      const size = file && (await studioImageDimensions(file))
      if (!size) throw new Error('参考图不可用，请重新选择')
      const ratio = Math.min(1, 1280 / Math.max(size.width, size.height))
      const doc = createStudioDocument(file.name)
      doc.width = Math.max(1, Math.round(size.width * ratio))
      doc.height = Math.max(1, Math.round(size.height * ratio))
      doc.background = 'transparent'
      doc.layers = [
        createImageLayer(originalPath, { x: 0, y: 0, width: doc.width, height: doc.height })
      ]
      const path = await snapshot(doc, file.name)
      references.push({ path, originalPath, doc: createBranchDocument(doc, path, file.name) })
    }
    installing = true
    return await saveWorkspaceState(workspaceId, (storage) =>
      installAIBranch(
        storage,
        workspaceId,
        workId,
        source,
        scope,
        area,
        label,
        productionId,
        inputPath,
        input,
        references
      )
    )
  } catch (error) {
    if (installing) {
      // A lost response can follow a committed state write. Confirm before deleting inputs.
      try {
        await reloadWorkspaceStorage(workspaceId)
        const installed = createWorkspaceWorksRepository(workspaceId, workspaceStorage(workspaceId))
          .load()
          .works.flatMap((work) => work.drafts)
          .find((draft) => draft.id === productionId)
        if (installed) return installed
      } catch {
        throw error
      }
    }
    await Promise.allSettled(saved.map((item) => deleteWorkspaceArtifact(item.id)))
    throw error
  }
}
