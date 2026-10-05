export type EditorVersionKind = 'audio' | 'video'
export interface EditorVersion<T = unknown> {
  id: string
  name: string
  createdAt: string
  kind: EditorVersionKind
  document: T
}
export interface EditorVersionStore<T = unknown> {
  version: 1
  entries: EditorVersion<T>[]
}
export const editorVersionLimit = 30
export const editorVersionByteLimit = 12 * 1024 * 1024
export const editorVersionsKey = (workspaceId: string, draftId: string) =>
  `omnigallery:editor-versions-v1:${workspaceId}:${draftId}`

/** Corrupt history must never be overwritten by an apparently empty list. */
export function readEditorVersions(raw: string | null): EditorVersionStore {
  if (raw === null) return { version: 1, entries: [] }
  const fail = () => {
    throw new Error('制作版本记录无法读取，原始记录已保留')
  }
  let value: EditorVersionStore
  try {
    value = JSON.parse(raw) as EditorVersionStore
  } catch {
    return fail()
  }
  if (!value || value.version !== 1 || !Array.isArray(value.entries)) return fail()
  const ids = new Set<string>()
  for (const entry of value.entries) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      ids.has(entry.id) ||
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      entry.name.length > 80 ||
      typeof entry.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.createdAt)) ||
      !['audio', 'video'].includes(entry.kind) ||
      !entry.document ||
      typeof entry.document !== 'object' ||
      Array.isArray(entry.document)
    )
      return fail()
    ids.add(entry.id)
  }
  return value
}

/** Snapshots contain edit instructions, never media bytes. Bound both count and UTF-8 size. */
export function appendEditorVersion<T>(
  store: EditorVersionStore,
  entry: EditorVersion<T>,
  byteLimit = editorVersionByteLimit
): EditorVersionStore {
  const copy = JSON.parse(JSON.stringify(entry)) as EditorVersion<T>
  readEditorVersions(JSON.stringify({ version: 1, entries: [copy] }))
  let entries: EditorVersion[] = [
    copy,
    ...store.entries.filter((item) => item.id !== copy.id)
  ].slice(0, editorVersionLimit)
  const size = () => new TextEncoder().encode(JSON.stringify({ version: 1, entries })).byteLength
  while (entries.length > 1 && size() > byteLimit) entries = entries.slice(0, -1)
  if (size() > byteLimit) throw new Error('当前制作文件过大，无法保存版本；现有版本已保留')
  return { version: 1, entries }
}

export function documentFromEditorVersion<T>(
  entry: EditorVersion,
  kind: EditorVersionKind,
  parse: (raw: string) => T
): T {
  if (entry.kind !== kind) throw new Error('版本类型与当前编辑器不匹配')
  return parse(JSON.stringify(entry.document))
}
