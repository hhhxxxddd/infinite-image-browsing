import { Paper, Text, Tooltip } from '@mantine/core'
import { IconHelpCircle } from '@tabler/icons-react'
import type { ReactNode } from 'react'

export function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function SettingsCard({
  title,
  description,
  help,
  actions,
  children
}: {
  title: string
  description?: string
  help?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Paper className="settings-card" withBorder>
      <header className="settings-card-header">
        <div>
          <div className="settings-card-title">
            <h3>{title}</h3>
            {help && (
              <Tooltip label={help} multiline w={300} withArrow>
                <span tabIndex={0} aria-label={`${title}说明`} className="settings-help">
                  <IconHelpCircle size={16} />
                </span>
              </Tooltip>
            )}
          </div>
          {description && (
            <Text size="sm" c="dimmed" mt={3}>
              {description}
            </Text>
          )}
        </div>
        {actions && <div className="settings-card-actions">{actions}</div>}
      </header>
      <div className="settings-card-body">{children}</div>
    </Paper>
  )
}

export function SettingsRow({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}
