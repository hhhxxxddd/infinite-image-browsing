import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { IconAlertCircle, IconFolderOpen, IconRefresh, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { formatFileSize } from '../../shared/formatFileSize'
import { useLanguage } from '../../design/i18n'
import { errorText, SettingsCard, SettingsRow } from './components'
import { chooseSettingsDirectory } from './chooseSettingsDirectory'
import { useSettingsWritable } from './SettingsAccess'

type StorageSettings = {
  directory: string
  default_directory: string
  pending_directory: string
  restart_required: boolean
  error: string
  backups: string[]
  directories: { name: string; label: string; path: string }[]
}
type StorageUsage = {
  directory: string
  total_bytes: number
  reclaimable_bytes: number
  skipped: number
  categories: {
    name: string
    label: string
    bytes: number
    files: number
    reclaimable_bytes: number
    skipped: number
  }[]
}
type CleanResult = { released_bytes: number; removed_files: number; skipped: number }

export default function ApplicationStorageSettings() {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [data, setData] = useState<StorageSettings>()
  const [usage, setUsage] = useState<StorageUsage>()
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [counting, setCounting] = useState(true)
  const [confirm, setConfirm] = useState<'move' | 'clear'>('move')
  const [confirming, setConfirming] = useState(false)
  const openConfirmation = (kind: 'move' | 'clear') => {
    setConfirm(kind)
    setConfirming(true)
  }

  useEffect(() => {
    let active = true
    void apiFetch<StorageSettings>('/application_storage')
      .then((value) => {
        if (!active) return
        setData(value)
        setDirectory(value.pending_directory || value.directory)
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取应用数据目录'))
      })
    void apiFetch<StorageUsage>('/application_storage/usage')
      .then((value) => {
        if (active) setUsage(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法统计存储占用'))
      })
      .finally(() => {
        if (active) setCounting(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function refreshUsage() {
    setCounting(true)
    setError('')
    try {
      setUsage(await apiFetch<StorageUsage>('/application_storage/usage'))
    } catch (cause) {
      setError(errorText(cause, '无法统计存储占用'))
    } finally {
      setCounting(false)
    }
  }

  async function save(value: string) {
    if (!writable || busy) return
    setBusy(true)
    setConfirming(false)
    setError('')
    setSuccess('')
    try {
      const next = await apiFetch<StorageSettings>('/application_storage', {
        method: 'PUT',
        body: JSON.stringify({ directory: value })
      })
      setData(next)
      setDirectory(next.pending_directory || next.directory)
      setSuccess(
        next.restart_required
          ? '已安排迁移。退出并重新启动应用或文件服务后生效。'
          : '已取消迁移，继续使用当前目录。'
      )
    } catch (cause) {
      setError(errorText(cause, '无法安排迁移'))
    } finally {
      setBusy(false)
    }
  }

  async function clean() {
    if (!writable || busy) return
    setBusy(true)
    setConfirming(false)
    setError('')
    setSuccess('')
    try {
      const result = await apiFetch<CleanResult>('/application_storage/clear-cache', {
        method: 'POST'
      })
      setSuccess(
        `已释放 ${formatFileSize(result.released_bytes)}，清理 ${result.removed_files} 个文件${result.skipped ? `，跳过 ${result.skipped} 个使用中或无法访问的项目` : ''}。`
      )
      await refreshUsage()
    } catch (cause) {
      setError(errorText(cause, '无法清理缓存'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      title={t('applicationDataDirectory')}
      description="工作区、模板、归档、数据库、缓存、模型和运行环境统一保存在此目录。"
      help="选择一个空目录。重启后复制并校验数据，再切换到新位置；原目录保留为备份。"
    >
      <SettingsRow label="目录位置" description="文件服务所在电脑的绝对路径。">
        <div className="settings-field-stack">
          <Group gap="xs" wrap="nowrap">
            <TextInput
              value={directory}
              onChange={(event) => setDirectory(event.currentTarget.value)}
              placeholder={data?.default_directory || '读取中…'}
              disabled={!writable || !data || busy}
              aria-label="应用数据目录"
            />
            <Button
              variant="default"
              px="sm"
              leftSection={<IconFolderOpen size={16} />}
              disabled={!writable || !data || busy}
              onClick={() =>
                void chooseSettingsDirectory(directory)
                  .then((value) => value && setDirectory(value))
                  .catch((cause: unknown) =>
                    setError(errorText(cause, '无法打开目录选择器；请手动输入路径。'))
                  )
              }
            >
              浏览
            </Button>
          </Group>
          <p className="settings-path">当前使用：{data?.directory || '读取中…'}</p>
          <Group gap="xs">
            <Button
              loading={busy}
              disabled={
                !writable ||
                !data ||
                busy ||
                !directory.trim() ||
                directory.trim() === (data.pending_directory || data.directory)
              }
              onClick={() => openConfirmation('move')}
            >
              重启后迁移
            </Button>
            {data?.restart_required && (
              <Button
                variant="default"
                disabled={!writable || busy}
                onClick={() => void save(data.directory)}
              >
                取消迁移
              </Button>
            )}
          </Group>
          {data?.restart_required && (
            <Alert color="blue">
              待迁移至：{data.pending_directory}
              <br />
              重启前仍使用当前目录。
            </Alert>
          )}
          {data?.error && (
            <Alert color="red">
              上次迁移失败：{data.error}。当前数据仍在原目录；可更换目标或取消迁移。
            </Alert>
          )}
          {!!data?.backups.length && (
            <details className="settings-storage-backups">
              <summary>原数据备份（{data.backups.length}）</summary>
              {data.backups.map((path) => (
                <p key={path} className="settings-path">
                  {path}
                </p>
              ))}
            </details>
          )}
        </div>
      </SettingsRow>
      <SettingsRow label="存储占用" description="仅统计应用管理的数据，媒体库原文件按原位置保存。">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>{usage ? formatFileSize(usage.total_bytes) : '统计中…'}</Text>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconRefresh size={14} />}
              loading={counting}
              disabled={busy}
              onClick={() => void refreshUsage()}
            >
              刷新统计
            </Button>
          </Group>
          <div className="settings-storage-usage">
            {usage?.categories.map((item) => (
              <div
                className="settings-storage-category"
                key={item.name}
                title={data?.directories.find((entry) => entry.name === item.name)?.path}
              >
                <span>{item.label}</span>
                <span>{formatFileSize(item.bytes)}</span>
              </div>
            ))}
          </div>
          {!!usage?.skipped && (
            <Text size="xs" c="dimmed">
              有 {usage.skipped} 项无法统计，显示已读取的占用。
            </Text>
          )}
          <Group justify="space-between">
            <Text size="sm">可清理 {formatFileSize(usage?.reclaimable_bytes || 0)}</Text>
            <Button
              variant="default"
              leftSection={<IconTrash size={15} />}
              disabled={!writable || busy || counting || !usage?.reclaimable_bytes}
              onClick={() => openConfirmation('clear')}
            >
              清理缓存
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            清理自动生成的缩略图和上次运行留下的临时文件。作品、模板、编辑记录、手动封面、模型与运行环境会保留。
          </Text>
        </Stack>
      </SettingsRow>
      {success && <Alert color="teal">{success}</Alert>}
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={17} />}>
          {error}
        </Alert>
      )}
      <Modal
        opened={confirming}
        onClose={() => setConfirming(false)}
        title={confirm === 'move' ? '迁移应用数据' : '清理缓存'}
      >
        <Text size="sm">
          {confirm === 'move'
            ? '下次启动时迁移数据库、作品、归档、模型和全部托管运行环境。原目录保留备份；迁移时间取决于数据大小。'
            : `预计释放 ${formatFileSize(usage?.reclaimable_bytes || 0)}。缓存会在下次访问时重新生成，使用中的文件会跳过。`}
        </Text>
        {confirm === 'move' && (
          <Text className="settings-path" size="xs" mt="sm">
            目标目录：{directory.trim()}
          </Text>
        )}
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setConfirming(false)}>
            取消
          </Button>
          <Button
            disabled={!writable || busy}
            onClick={() => void (confirm === 'move' ? save(directory.trim()) : clean())}
          >
            {confirm === 'move' ? '安排迁移' : '清理缓存'}
          </Button>
        </Group>
      </Modal>
    </SettingsCard>
  )
}
