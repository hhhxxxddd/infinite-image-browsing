import type { ReactNode } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconListCheck, IconNotes } from '@tabler/icons-react'
import './EditorActions.css'

type ToggleAction = { opened: boolean; onToggle: () => void }

export default function EditorActions({
  className = '',
  children,
  notes,
  versions,
  tasks
}: {
  className?: string
  children?: ReactNode
  notes?: ToggleAction
  versions?: ReactNode
  tasks: ToggleAction & { running?: boolean }
}) {
  return (
    <div className={`editor-actions ${className}`} role="group" aria-label="编辑器功能">
      {children && (
        <>
          <div className="editor-actions-navigation">{children}</div>
          <span className="editor-actions-divider" aria-hidden="true" />
        </>
      )}
      {notes && (
        <Tooltip label="制作笔记">
          <ActionIcon
            aria-label="制作笔记"
            aria-expanded={notes.opened}
            aria-controls="editor-notes-panel"
            variant={notes.opened ? 'light' : 'subtle'}
            onClick={notes.onToggle}
          >
            <IconNotes size={18} />
          </ActionIcon>
        </Tooltip>
      )}
      {versions}
      <Tooltip label={tasks.running ? '任务列表 · 有任务进行中' : '任务列表'}>
        <ActionIcon
          aria-label="任务列表"
          aria-expanded={tasks.opened}
          aria-controls="editor-task-list"
          variant={tasks.opened ? 'light' : 'subtle'}
          onClick={tasks.onToggle}
          className="editor-tasks-button"
        >
          <IconListCheck size={18} />
          {tasks.running && <span className="editor-task-indicator" aria-hidden="true" />}
        </ActionIcon>
      </Tooltip>
    </div>
  )
}
