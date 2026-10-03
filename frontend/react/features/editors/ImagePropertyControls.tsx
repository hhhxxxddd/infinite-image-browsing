import type { ReactNode } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'

export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="react-image-property-row">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  )
}

export function PropertyButton({
  label,
  active,
  disabled,
  onClick,
  children
}: {
  label: string
  active?: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip label={label}>
      <ActionIcon
        size={30}
        aria-label={label}
        aria-pressed={active}
        variant={active ? 'light' : 'subtle'}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  )
}
