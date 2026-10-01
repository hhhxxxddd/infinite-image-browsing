import { ActionIcon, Button, Collapse, Paper, Popover, Text, Tooltip } from '@mantine/core'
import { IconHelpCircle, IconInfoCircle, IconMinus, IconPlus } from '@tabler/icons-react'
import { type ReactNode, useId, useState } from 'react'

export function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function SettingsCard({
  title,
  description,
  help,
  helpContent,
  actions,
  children
}: {
  title: string
  description?: string
  help?: string
  helpContent?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Paper className="settings-card" withBorder>
      <header className="settings-card-header">
        <div>
          <div className="settings-card-title">
            <h3>{title}</h3>
            {helpContent && (
              <Popover position="bottom-start" width="min(640px, calc(100vw - 32px))" withArrow>
                <Popover.Target>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={`${title}支持版本说明`}
                  >
                    <IconHelpCircle size={17} />
                  </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown className="settings-model-help">{helpContent}</Popover.Dropdown>
              </Popover>
            )}
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

export function SettingsDetails({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState(false)
  const id = useId()
  return (
    <div className="settings-details">
      <Button
        size="xs"
        variant="subtle"
        color="gray"
        leftSection={<IconInfoCircle size={15} />}
        rightSection={opened ? <IconMinus size={14} /> : <IconPlus size={14} />}
        aria-expanded={opened}
        aria-controls={id}
        onClick={() => setOpened((current) => !current)}
      >
        环境详情
      </Button>
      <Collapse expanded={opened} id={id}>
        {children}
      </Collapse>
    </div>
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
