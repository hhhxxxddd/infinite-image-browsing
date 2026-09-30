import {
  readStudioDocument,
  type StudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel.ts'

export function savedAIEditDocument(
  storage: Pick<Storage, 'getItem'>,
  suffix: string,
  path: string
): StudioDocument | null {
  if (!path) return null
  const raw = storage.getItem(`omnigallery:ai-image-edit-v1:${suffix}:${encodeURIComponent(path)}`)
  if (!raw) return null
  const document = readStudioDocument(JSON.parse(raw))
  if (!document) throw new Error('已保存的 AI 编辑画布无法读取')
  return document
}

export function savedAIReferencePaths(
  storage: Pick<Storage, 'getItem'>,
  suffix: string,
  mainPath: string
): string[] | null {
  if (!mainPath) return null
  const raw = storage.getItem(
    `omnigallery:ai-image-refs-v1:${suffix}:${encodeURIComponent(mainPath)}`
  )
  if (!raw) return null
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('已保存的参考图列表无法读取')
  return parsed.filter((path): path is string => typeof path === 'string').slice(0, 13)
}

export function savedAIReferenceDocument(
  storage: Pick<Storage, 'getItem'>,
  suffix: string,
  mainPath: string,
  referencePath: string
): StudioDocument | null {
  const raw = storage.getItem(
    `omnigallery:ai-image-ref-v1:${suffix}:${encodeURIComponent(mainPath)}:${encodeURIComponent(referencePath)}`
  )
  if (!raw) return null
  const document = readStudioDocument(JSON.parse(raw))
  if (!document) throw new Error('已保存的 AI 参考图画布无法读取')
  return document
}
