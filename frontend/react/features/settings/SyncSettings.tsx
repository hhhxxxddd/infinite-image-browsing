import { Alert, Button, Group, Switch, Text, TextInput } from '@mantine/core'
import { IconAlertCircle, IconCheck, IconFolderOpen } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { useLanguage } from '../../design/i18n'
import { errorText, SettingsCard, SettingsRow } from './components'
import { chooseSettingsDirectory } from './chooseSettingsDirectory'
import { useSettingsWritable } from './SettingsAccess'

type SyncConfig = { enabled: boolean; directory: string }

export default function SyncSettings() {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [config, setConfig] = useState<SyncConfig>()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    let active = true
    void apiFetch<SyncConfig>('/sync_settings')
      .then((value) => {
        if (active) setConfig(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取同步设置'))
      })
    return () => {
      active = false
    }
  }, [])

  async function browse() {
    if (!writable) return
    try {
      const result = await chooseSettingsDirectory(config?.directory || '')
      if (result) setConfig((current) => (current ? { ...current, directory: result } : current))
    } catch (cause) {
      setError(errorText(cause, '无法打开目录选择器；请手动输入路径。'))
    }
  }

  async function save() {
    if (!config || !writable) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const next = await apiFetch<SyncConfig>('/sync_settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: config.enabled, directory: config.directory.trim() })
      })
      setConfig(next)
      setMessage(next.enabled ? '同步设置已保存，正在扫描目录。' : '按需文件保护已关闭。')
      setSaving(false)
      if (next.enabled) {
        setScanning(true)
        try {
          await apiFetch<unknown>('/update_image_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          })
          setMessage('同步目录扫描完成。')
        } catch (cause) {
          setError(errorText(cause, '目录已保存，但扫描未完成；请在媒体库重试。'))
        } finally {
          setScanning(false)
        }
      }
    } catch (cause) {
      setError(errorText(cause, '保存同步设置失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-stack">
      <SettingsCard
        title={t('oneDriveFolder')}
        description="文件传输由本机 OneDrive 完成；标签和应用数据库仍保存在本机。"
      >
        <SettingsRow
          label="按需文件保护"
          description="仅在线文件在扫描时不会读取内容；打开前提示下载大小。"
        >
          <Switch
            checked={config?.enabled || false}
            onChange={(event) => {
              const enabled = event.currentTarget.checked
              setConfig((current) => (current ? { ...current, enabled } : current))
            }}
            disabled={!writable || !config || saving || scanning}
            aria-label="按需文件保护"
          />
        </SettingsRow>
        <SettingsRow label="媒体文件夹" description="选择 OneDrive 管理的本地目录。">
          <Group gap="xs" wrap="nowrap">
            <TextInput
              value={config?.directory || ''}
              onChange={(event) => {
                const directory = event.currentTarget.value
                setConfig((current) => (current ? { ...current, directory } : current))
              }}
              disabled={!writable || !config || saving || scanning}
              placeholder="填写 OneDrive 文件夹的绝对路径"
              aria-label="OneDrive 媒体文件夹"
            />
            <Button
              variant="default"
              leftSection={<IconFolderOpen size={16} />}
              disabled={!writable || !config || saving || scanning}
              onClick={() => void browse()}
            >
              浏览
            </Button>
          </Group>
        </SettingsRow>
        <SettingsRow label="应用更改">
          <div className="settings-field-stack">
            <Group gap="xs">
              <Button
                onClick={() => void save()}
                loading={saving || scanning}
                disabled={!writable || !config}
              >
                {scanning ? '正在扫描媒体…' : '保存设置'}
              </Button>
              <Text size="xs" c="dimmed">
                保存并开启后目录会加入媒体库。
              </Text>
            </Group>
            {message && (
              <Alert color="teal" icon={<IconCheck size={17} />}>
                {message}
              </Alert>
            )}
            {error && (
              <Alert color="red" icon={<IconAlertCircle size={17} />}>
                {error}
              </Alert>
            )}
          </div>
        </SettingsRow>
      </SettingsCard>
    </div>
  )
}
