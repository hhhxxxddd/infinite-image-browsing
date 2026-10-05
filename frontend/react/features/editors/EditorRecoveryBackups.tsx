import { useEffect, useState } from 'react'
import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import { IconDownload } from '@tabler/icons-react'
import EditorDisclosure from './EditorDisclosure'
import { readWorkspaceState, subscribeWorkspaceState } from '../../shared/workspaceState'
import {
  editorRecoveryIndexKey,
  editorRecoveryRawKey,
  readEditorRecoveries,
  type EditorRecoveryBackup
} from './editorRecovery'

export function downloadEditorRaw(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name.replace(/[\\/:*?"<>|]/g, '_') || '制作文件'}-原始副本.json`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/** Recovery copies remain downloadable after the healthy editor is opened again. */
export default function EditorRecoveryBackups({
  workspaceId,
  draftId
}: {
  workspaceId: string
  draftId: string
}) {
  const [entries, setEntries] = useState<EditorRecoveryBackup[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const refresh = () => {
      try {
        setEntries(
          readEditorRecoveries(
            readWorkspaceState(workspaceId).getItem(editorRecoveryIndexKey(workspaceId, draftId))
          )
        )
        setError('')
      } catch (cause) {
        setEntries([])
        setError(cause instanceof Error ? cause.message : '无法读取损坏副本')
      }
    }
    refresh()
    return subscribeWorkspaceState(workspaceId, refresh)
  }, [workspaceId, draftId])
  if (!entries.length && !error) return null
  return (
    <EditorDisclosure
      className="editor-recovery-backups"
      title={`恢复时保留的原始副本 · ${entries.length}`}
    >
      <Stack gap="xs" mt="xs">
        {error && <Alert color="red">{error}</Alert>}
        {entries.map((entry) => (
          <Group key={entry.id} justify="space-between" wrap="nowrap">
            <div>
              <Text size="xs">{new Date(entry.createdAt).toLocaleString()}</Text>
              <Text size="xs" c="dimmed">
                恢复到 {entry.versionName} · {(entry.bytes / 1024).toFixed(1)} KB
              </Text>
            </div>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconDownload size={13} />}
              onClick={() => {
                try {
                  const raw = readWorkspaceState(workspaceId).getItem(
                    editorRecoveryRawKey(workspaceId, draftId, entry.id)
                  )
                  if (raw === null) throw new Error('原始副本已不存在')
                  downloadEditorRaw(raw, `${entry.name}-${entry.id.slice(0, 8)}`)
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : '下载副本失败')
                }
              }}
            >
              下载
            </Button>
          </Group>
        ))}
      </Stack>
    </EditorDisclosure>
  )
}
