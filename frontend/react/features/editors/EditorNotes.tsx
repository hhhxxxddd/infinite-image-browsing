import { useEffect, useRef, useState } from 'react'
import { ActionIcon, Alert, Button, Group, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import './EditorActions.css'
import { editorNotesLimit } from './editorNotesModel'

export default function EditorNotes({
  value,
  onChange,
  readonly = false,
  saving = false,
  dirty = false,
  error,
  onSave,
  onClose
}: {
  value: string
  onChange: (value: string) => void
  readonly?: boolean
  saving?: boolean
  dirty?: boolean
  error?: string
  onSave: () => Promise<void>
  onClose: () => void
}) {
  const [closing, setClosing] = useState(false)
  const current = useRef({ onSave, onClose, readonly })
  current.current = { onSave, onClose, readonly }
  const closePending = useRef(false)
  const live = useRef(true)
  async function close() {
    if (closePending.current) return
    closePending.current = true
    setClosing(true)
    try {
      if (!current.current.readonly) await current.current.onSave()
      if (live.current) current.current.onClose()
    } catch {
      // The shared notes saver owns the error so toolbar retries clear it here too.
    } finally {
      closePending.current = false
      if (live.current) setClosing(false)
    }
  }
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    live.current = true
    function escape(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('[role="dialog"]:not(#editor-notes-panel)')
      )
        return
      event.preventDefault()
      event.stopPropagation()
      void closeRef.current()
    }
    window.addEventListener('keydown', escape, true)
    return () => {
      live.current = false
      window.removeEventListener('keydown', escape, true)
    }
  }, [])
  return (
    <section
      className="editor-notes-panel"
      id="editor-notes-panel"
      role="dialog"
      aria-label="制作笔记"
    >
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={700} size="sm">
            制作笔记
          </Text>
          <Tooltip label="关闭制作笔记">
            <ActionIcon
              aria-label="关闭制作笔记"
              variant="subtle"
              disabled={saving || closing}
              onClick={() => void close()}
            >
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Textarea
          aria-label="制作笔记内容"
          placeholder="记录创作思路、修改要求或待办事项"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          autosize
          minRows={8}
          maxRows={16}
          maxLength={editorNotesLimit}
          readOnly={readonly}
        />
        {error && <Alert color="red">{error}</Alert>}
        {!readonly && (
          <Button
            size="xs"
            loading={saving || closing}
            disabled={!dirty}
            onClick={() => {
              void onSave().catch(() => {})
            }}
          >
            保存笔记
          </Button>
        )}
      </Stack>
    </section>
  )
}
