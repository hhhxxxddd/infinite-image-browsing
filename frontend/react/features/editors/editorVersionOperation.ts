import type { EditorVersionKind } from './editorVersionModel.ts'

export interface EditorVersionScope {
  workspaceId: string
  draftId: string
  kind: EditorVersionKind
  readonly?: boolean
  disabled?: boolean
  revision?: number
}

/** Async saves must stay bound to the production file that started the operation. */
export function editorVersionGuard(
  scope: EditorVersionScope,
  current: () => EditorVersionScope,
  live: () => boolean,
  writable = true
) {
  const captured = { ...scope }
  return () => {
    const next = current()
    if (
      !live() ||
      next.workspaceId !== captured.workspaceId ||
      next.draftId !== captured.draftId ||
      next.kind !== captured.kind ||
      next.revision !== captured.revision
    )
      throw new Error('编辑器已切换或关闭，本次制作版本操作已取消')
    if (writable && (next.readonly || next.disabled)) throw new Error('当前制作文件不可修改')
  }
}

/** No restoration is allowed until saving the current file and its backup both succeed. */
export async function restoreEditorVersion<T>({
  guard,
  read,
  beforeSave,
  backup,
  restore
}: {
  guard: () => void
  read: () => T
  beforeSave: () => Promise<boolean>
  backup: () => Promise<unknown>
  restore: (document: T) => void | Promise<void>
}) {
  guard()
  const document = read()
  if (!(await beforeSave())) throw new Error('请先完成当前操作并保存制作文件')
  guard()
  await backup()
  guard()
  await restore(document)
  guard()
}
