import { useState } from 'react'
import { ActionIcon, Button, Group, Modal, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { IconPencil } from '@tabler/icons-react'

export default function EditorRenameButton({
  name,
  disabled,
  extension,
  onRename
}: {
  name: string
  disabled?: boolean
  extension?: string
  onRename: (name: string) => Promise<void>
}) {
  const [opened, setOpened] = useState(false)
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    if (saving || disabled || !value.trim()) return
    setSaving(true)
    setError('')
    try {
      await onRename(value.trim())
      setOpened(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '修改名称失败，请重试')
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <Tooltip label="修改名称">
        <ActionIcon
          aria-label="修改名称"
          variant="subtle"
          disabled={disabled}
          onClick={() => {
            setValue(name)
            setError('')
            setOpened(true)
          }}
        >
          <IconPencil size={18} />
        </ActionIcon>
      </Tooltip>
      <Modal
        opened={opened}
        onClose={() => !saving && setOpened(false)}
        title={extension ? '修改原文件名' : '修改制作名称'}
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
        withCloseButton={!saving}
        centered
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Stack>
            <Text size="sm" c="dimmed">
              {extension
                ? `重命名媒体库中的原文件，保留 ${extension} 扩展名。当前编辑会保留。`
                : '修改当前制作文件的名称。'}
            </Text>
            <TextInput
              label="名称"
              data-autofocus
              maxLength={extension ? 120 : 80}
              value={value}
              disabled={saving}
              error={error}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button variant="default" disabled={saving} onClick={() => setOpened(false)}>
                取消
              </Button>
              <Button type="submit" loading={saving} disabled={disabled || !value.trim()}>
                保存
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  )
}
