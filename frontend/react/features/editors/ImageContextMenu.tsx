import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Menu } from '@mantine/core'
import { IconChevronRight } from '@tabler/icons-react'

export type ImageContextAction = {
  label: string
  run: () => void
  disabled?: boolean
  danger?: boolean
}
export type ImageContextItem =
  | ImageContextAction
  | {
      label: string
      disabled?: boolean
      children: ImageContextAction[]
    }
  | { label: string; content: ReactNode }

export default function ImageContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: ImageContextItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const align = () => {
      const bounds = node.getBoundingClientRect()
      setPosition({
        left: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))
      })
    }
    align()
    node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    window.addEventListener('resize', align)
    return () => window.removeEventListener('resize', align)
  }, [x, y])
  return (
    <div
      className="react-image-menu-mask"
      onPointerDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={ref}
        className="react-image-context-menu"
        role="menu"
        aria-label="画布对象操作"
        style={position}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest('[role="menu"]') !== event.currentTarget) return
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
            return
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              ':scope > button:not(:disabled), :scope > div > button:not(:disabled)'
            )
          ]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }}
      >
        {items.map((item) =>
          'content' in item ? (
            <Fragment key={item.label}>{item.content}</Fragment>
          ) : 'children' in item ? (
            <Menu
              key={item.label}
              position="right-start"
              offset={6}
              width={200}
              withinPortal
              portalProps={{ target: '.react-editor-shell' }}
              zIndex={85}
              returnFocus={false}
              transitionProps={{ duration: 0 }}
            >
              <Menu.Target>
                <button
                  type="button"
                  role="menuitem"
                  className="react-image-group-menu-target"
                  disabled={item.disabled}
                >
                  {item.label}
                  <IconChevronRight size={13} />
                </button>
              </Menu.Target>
              <Menu.Dropdown
                className="react-image-tool-popover react-image-group-dropdown"
                onPointerDown={(event) => event.stopPropagation()}
              >
                {item.children.map((child, index) => (
                  <Menu.Item
                    key={`${index}-${child.label}`}
                    disabled={child.disabled}
                    title={child.label}
                    color={child.danger ? 'red' : undefined}
                    onClick={() => {
                      child.run()
                      onClose()
                    }}
                  >
                    {child.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          ) : (
            <button
              type="button"
              role="menuitem"
              key={item.label}
              disabled={item.disabled}
              data-danger={item.danger || undefined}
              onClick={() => {
                item.run()
                onClose()
              }}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}
