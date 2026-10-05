import { createWorkspaceWorksRepository } from '../../../src/features/workspaces/model/workspaceWorks.ts'

export const editorNotesLimit = 5000
export type EditorNotesScope = { workspaceId: string; workId: string; draftId: string }

/** Call inside the workspace transaction so stale editors cannot replace another window's notes. */
export function saveEditorNotes(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  scope: EditorNotesScope,
  expected: string,
  value: string
) {
  if (value.length > editorNotesLimit)
    throw new Error(`制作笔记最多支持 ${editorNotesLimit} 字，本次修改尚未保存`)
  const repository = createWorkspaceWorksRepository(scope.workspaceId, storage)
  const current = repository.load()
  const work = current.works.find((entry) => entry.id === scope.workId)
  const draft = work?.drafts.find((entry) => entry.id === scope.draftId)
  if (!draft) throw new Error('制作文件已删除或已移出当前作品；本次笔记尚未保存')
  if (draft.brief !== expected && draft.brief !== value)
    throw new Error('制作笔记已在其他窗口修改，请复制本次内容后重新打开；本次笔记尚未保存')
  repository.save({
    ...current,
    works: current.works.map((entry) =>
      entry.id === scope.workId
        ? {
            ...entry,
            drafts: entry.drafts.map((item) =>
              item.id === scope.draftId
                ? { ...item, brief: value, updatedAt: new Date().toISOString() }
                : item
            )
          }
        : entry
    )
  })
}
