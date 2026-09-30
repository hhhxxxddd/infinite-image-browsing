import type { ProductionKind } from '../../../src/features/workspaces/model/workspaceWorks.ts'
import {
  readStudioDocument,
  type StudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel.ts'

export function readAIDraftCover(
  storage: Pick<Storage, 'getItem'>,
  workspaceId: string,
  workId: string,
  draftId: string
): { mainPath: string; document: StudioDocument | null; referenceCount: number } {
  const scope = `${workspaceId}:${workId}:${draftId}`
  const mainPath = storage.getItem(`omnigallery:ai-image-edit-asset-v1:${scope}`) || ''
  if (!mainPath) return { mainPath: '', document: null, referenceCount: 0 }
  const raw = storage.getItem(
    `omnigallery:ai-image-edit-v1:${scope}:${encodeURIComponent(mainPath)}`
  )
  let document: StudioDocument | null = null
  try {
    document = readStudioDocument(JSON.parse(raw ?? 'null')) ?? null
  } catch {
    /* Preserve the main image identity even if its saved edit document is damaged. */
  }
  let referenceCount = 0
  try {
    const paths: unknown = JSON.parse(
      storage.getItem(`omnigallery:ai-image-refs-v1:${scope}:${encodeURIComponent(mainPath)}`) ??
        '[]'
    )
    if (Array.isArray(paths))
      referenceCount = new Set(paths.filter((path) => typeof path === 'string' && path)).size
  } catch {
    /* A damaged reference list does not hide the main image. */
  }
  return { mainPath, document, referenceCount }
}

export function draftCoverFallback({
  kind,
  generation,
  loaded,
  mainPath
}: {
  kind: ProductionKind
  generation: boolean
  loaded: boolean
  mainPath: string
}): string {
  if (!loaded) return '正在读取制作封面…'
  if (generation) return '纯文字生成 · 尚无产物'
  if (kind === 'ai') return mainPath ? '封面暂不可用' : '尚未设置主图'
  if (kind === 'audio') return '声音时间线'
  return kind === 'image' ? '图片画布制作文件' : '视频剪辑制作文件'
}
