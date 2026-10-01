import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { ActionIcon, Portal } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import { useMediaText } from './mediaLocale'
import './mediaFilterPanel.css'

/** A nonmodal panel stays inside the library and leaves browsing available. */
export function MediaFilterPanel({
  opened,
  onClose,
  children
}: {
  opened: boolean
  onClose: () => void
  children: ReactNode
}) {
  const m = useMediaText()
  const panelRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLElement>(null)
  const bindPanel = useCallback((panel: HTMLElement | null) => {
    panelRef.current = panel
    if (panel) {
      if (!panel.contains(document.activeElement)) {
        triggerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
      }
      panel.focus()
    }
  }, [])
  useEffect(() => {
    if (!opened) return
    panelRef.current?.focus()
    return () => {
      const trigger = triggerRef.current
      if (
        trigger?.isConnected &&
        (panelRef.current?.contains(document.activeElement) ||
          document.activeElement === document.body)
      )
        trigger.focus()
    }
  }, [opened])
  if (!opened) return null
  return (
    <Portal target=".omni-main">
      <aside
        id="ml-library-filter-panel"
        ref={bindPanel}
        className="ml-filter-panel"
        aria-label={m('筛选媒体')}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="ml-filter-panel-heading">
          <strong>{m('筛选媒体')}</strong>
          <ActionIcon variant="subtle" color="gray" aria-label={m('关闭筛选')} onClick={onClose}>
            <IconX size={17} />
          </ActionIcon>
        </header>
        {children}
      </aside>
    </Portal>
  )
}
