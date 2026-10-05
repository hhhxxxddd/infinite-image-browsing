import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorContext } from './EditorHub'
import { EditorSaveQueue } from './editorSaveQueue'
import { mutateWorkspaceState } from '../../shared/workspaceState'
import { saveEditorNotes } from './editorNotesModel'

export function useEditorNotes(context: EditorContext, enabled = true) {
  const [value, setNote] = useState(context.draft.brief || '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savedValue = useRef(context.draft.brief || '')
  const policy = useRef({ context, enabled, live: true })
  const origin = useRef({
    workspaceId: context.workspaceId,
    draftId: context.draft.id,
    workId: context.work.id
  })
  policy.current.context = context
  policy.current.enabled = enabled
  const [queue] = useState(
    () =>
      new EditorSaveQueue(value, async (snapshot) => {
        const state = policy.current
        if (!state.live || !state.enabled || state.context.readonly)
          throw new Error('当前制作笔记不可修改')
        const { workspaceId, work, draft } = state.context
        if (
          workspaceId !== origin.current.workspaceId ||
          draft.id !== origin.current.draftId ||
          work.id !== origin.current.workId
        )
          throw new Error('制作文件已切换，请重新打开笔记')
        await mutateWorkspaceState(workspaceId, (storage) => {
          if (!policy.current.live || policy.current.context.readonly || !policy.current.enabled)
            throw new Error('编辑器已关闭或不可修改')
          if (
            policy.current.context.workspaceId !== workspaceId ||
            policy.current.context.work.id !== work.id ||
            policy.current.context.draft.id !== draft.id
          )
            throw new Error('制作文件已切换，本次笔记尚未保存')
          saveEditorNotes(storage, origin.current, savedValue.current, snapshot)
        })
        savedValue.current = snapshot
      })
  )
  const pending = useRef(0)
  const flush = useCallback(async () => {
    if (!policy.current.enabled || policy.current.context.readonly || !queue.dirty) return
    pending.current++
    setSaving(true)
    try {
      await queue.flush()
      if (policy.current.live) {
        setDirty(queue.dirty)
        setError('')
      }
    } catch (cause) {
      if (policy.current.live) setError(cause instanceof Error ? cause.message : '制作笔记未能保存')
      throw cause
    } finally {
      pending.current--
      if (policy.current.live) setSaving(pending.current > 0)
    }
  }, [queue])
  const setValue = useCallback(
    (next: string) => {
      if (!policy.current.enabled || policy.current.context.readonly) return
      queue.update(next)
      setNote(next)
      setDirty(queue.dirty)
    },
    [queue]
  )
  useEffect(() => {
    policy.current.live = true
    const warn = (event: BeforeUnloadEvent) => {
      if (!policy.current.enabled || !queue.dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      policy.current.live = false
      window.removeEventListener('beforeunload', warn)
    }
  }, [queue])
  return { value, setValue, dirty, saving, error, flush }
}
