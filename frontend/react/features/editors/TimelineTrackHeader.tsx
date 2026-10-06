import { useRef, useState, type MouseEventHandler, type ReactNode } from 'react'
import './TimelineControls.css'

export default function TimelineTrackHeader({
  name,
  className = '',
  active = false,
  related = false,
  readonly = false,
  metadata,
  onSelect,
  onRename,
  onContextMenu,
  children
}: {
  name: string
  className?: string
  active?: boolean
  related?: boolean
  readonly?: boolean
  metadata?: ReactNode
  onSelect?: () => void
  onRename?: (name: string) => void
  onContextMenu?: MouseEventHandler<HTMLDivElement>
  children?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const cancelled = useRef(false)
  function beginRename() {
    if (readonly || !onRename) return
    cancelled.current = false
    setDraft(name)
    setEditing(true)
  }
  function finishRename() {
    const next = draft.trim()
    if (!cancelled.current && !readonly && next && next !== name) onRename?.(next)
    setEditing(false)
  }
  return (
    <div
      className={`timeline-track-header ${className}`}
      data-active={active || undefined}
      data-related={related || undefined}
      data-selectable={!!onSelect || undefined}
      role="group"
      aria-label={`${name}轨道`}
      onClick={onSelect}
      onContextMenu={(event) => {
        if (!(event.target instanceof HTMLInputElement)) onContextMenu?.(event)
      }}
    >
      <div className="timeline-track-heading">
        {editing ? (
          <input
            autoFocus
            className="timeline-track-name-input"
            aria-label={`修改轨道名称：${name}`}
            maxLength={120}
            value={draft}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={finishRename}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') {
                cancelled.current = true
                setEditing(false)
              }
            }}
          />
        ) : onSelect ? (
          <button
            type="button"
            className="timeline-track-name"
            aria-label={`选择轨道：${name}`}
            aria-pressed={active}
            title={readonly || !onRename ? name : `${name}；双击改名`}
            onClick={(event) => {
              event.stopPropagation()
              onSelect()
            }}
            onDoubleClick={beginRename}
            onKeyDown={(event) => {
              if (event.key === 'F2') {
                event.preventDefault()
                event.stopPropagation()
                beginRename()
              }
            }}
          >
            {name}
          </button>
        ) : (
          <span className="timeline-track-name">{name}</span>
        )}
        {metadata != null && <small className="timeline-track-metadata">{metadata}</small>}
      </div>
      {children && <div className="timeline-track-actions">{children}</div>}
    </div>
  )
}
