import { Alert, Button, Group, Modal, Switch, Text, TextInput } from '@mantine/core'
import { IconAlertCircle, IconCheck, IconFolderOpen, IconRefresh } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { useLanguage } from '../../design/i18n'
import { errorText, SettingsCard, SettingsRow } from './components'
import { chooseSettingsDirectory } from './chooseSettingsDirectory'
import { useSettingsWritable } from './SettingsAccess'

type ProjectStorage = {
  directory: string
  default_directory: string
  custom_directory: string
  previous_directory?: string
  migrated?: boolean
}
type ArchiveStorage = {
  directory: string
  custom_directory: string
  default_directory: string
}
type ProxySettings = { enabled: boolean; url: string }
type ProxyCheck = { ready: boolean; detail: string }

function ProjectStorageSettings() {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [data, setData] = useState<ProjectStorage>()
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let active = true
    void apiFetch<ProjectStorage>('/project_storage')
      .then((value) => {
        if (active) {
          setData(value)
          setDirectory(value.directory)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取项目数据目录'))
      })
    return () => {
      active = false
    }
  }, [])

  async function save(value: string) {
    if (!writable) return
    setBusy(true)
    setError('')
    setSuccess('')
    setConfirming(false)
    try {
      const next = await apiFetch<ProjectStorage>('/project_storage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: value })
      })
      setData(next)
      setDirectory(next.directory)
      setSuccess(next.migrated ? '项目数据已校验并迁移至新目录。' : '项目数据目录已保存。')
    } catch (cause) {
      setError(errorText(cause, '迁移失败；原目录仍在使用。'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      title={t('projectDataDirectory')}
      description="存放工作区素材、制作文件与快照；不会自动扫描进媒体库。"
      help="切换时会校验并迁移已有项目数据，原目录保留备份。"
    >
      <SettingsRow label="目录位置" description="输入文件服务所在电脑的绝对路径。">
        <div className="settings-field-stack">
          <Group gap="xs" wrap="nowrap">
            <TextInput
              value={directory}
              onChange={(event) => setDirectory(event.currentTarget.value)}
              placeholder={data?.default_directory || '读取中…'}
              disabled={busy || !data || !writable}
              aria-label="项目数据目录"
            />
            <Button
              variant="default"
              px="sm"
              leftSection={<IconFolderOpen size={16} />}
              disabled={busy || !data || !writable}
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
          <div className="settings-field-actions">
            <Button
              disabled={
                !writable ||
                !data ||
                !directory.trim() ||
                directory.trim() === data.directory ||
                busy
              }
              loading={busy}
              onClick={() => setConfirming(true)}
            >
              迁移并使用
            </Button>
            <Button
              variant="default"
              disabled={!writable || !data || data.directory === data.default_directory || busy}
              onClick={() => void save('')}
            >
              恢复默认
            </Button>
          </div>
          {data?.previous_directory && (
            <Text size="xs" c="dimmed">
              原数据备份：{data.previous_directory}
            </Text>
          )}
          {success && (
            <Alert color="teal" icon={<IconCheck size={17} />}>
              {success}
            </Alert>
          )}
          {error && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>
              {error}
            </Alert>
          )}
        </div>
      </SettingsRow>
      <Modal opened={confirming} onClose={() => setConfirming(false)} title="迁移项目数据">
        <Text size="sm">应用将校验并迁移工作区文件；原数据会保留备份。迁移期间请勿关闭应用。</Text>
        <Text size="xs" c="dimmed" mt="sm" style={{ overflowWrap: 'anywhere' }}>
          目标目录：{directory.trim()}
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setConfirming(false)}>
            取消
          </Button>
          <Button disabled={!writable} onClick={() => void save(directory.trim())}>
            开始迁移
          </Button>
        </Group>
      </Modal>
    </SettingsCard>
  )
}

function ArchiveSettings() {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [data, setData] = useState<ArchiveStorage>()
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void apiFetch<ArchiveStorage>('/archive_settings')
      .then((value) => {
        if (active) {
          setData(value)
          setDirectory(value.custom_directory)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取归档目录'))
      })
    return () => {
      active = false
    }
  }, [])

  async function save(value: string) {
    if (!writable) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const next = await apiFetch<ArchiveStorage>('/archive_settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: value })
      })
      setData(next)
      setDirectory(next.custom_directory)
      setSaved(true)
    } catch (cause) {
      setError(errorText(cause, '保存归档目录失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      title={t('archiveDirectory')}
      description="归档操作之后使用的文件位置；不会移动已有归档。"
    >
      <SettingsRow label="保存位置">
        <div className="settings-field-stack">
          <Group gap="xs" wrap="nowrap">
            <TextInput
              value={directory}
              onChange={(event) => {
                setDirectory(event.currentTarget.value)
                setSaved(false)
              }}
              placeholder={data?.default_directory || '填写绝对路径'}
              disabled={busy || !data || !writable}
              aria-label="归档目录"
            />
            <Button
              variant="default"
              px="sm"
              leftSection={<IconFolderOpen size={16} />}
              disabled={busy || !data || !writable}
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
          <div className="settings-field-actions">
            <Button
              disabled={!writable || !data || busy || directory === data.custom_directory}
              loading={busy}
              onClick={() => void save(directory.trim())}
            >
              保存目录
            </Button>
            <Button
              variant="default"
              disabled={!writable || !data || busy || !data.custom_directory}
              onClick={() => void save('')}
            >
              恢复默认
            </Button>
            {saved && <span className="settings-inline-status">已保存</span>}
          </div>
          {error && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>
              {error}
            </Alert>
          )}
        </div>
      </SettingsRow>
    </SettingsCard>
  )
}

function NetworkProxySettings() {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [saved, setSaved] = useState<ProxySettings>()
  const [enabled, setEnabled] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [check, setCheck] = useState<ProxyCheck>()
  const [busy, setBusy] = useState(false)
  const dirty = !!saved && (enabled !== saved.enabled || url.trim() !== saved.url)

  useEffect(() => {
    let active = true
    void apiFetch<ProxySettings>('/network-proxy')
      .then((value) => {
        if (active) {
          setSaved(value)
          setEnabled(value.enabled)
          setUrl(value.url)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取代理设置'))
      })
    return () => {
      active = false
    }
  }, [])

  async function save() {
    if (!writable) return
    setBusy(true)
    setError('')
    setCheck(undefined)
    try {
      const next = await apiFetch<ProxySettings>('/network-proxy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, url: url.trim() })
      })
      setSaved(next)
      setEnabled(next.enabled)
      setUrl(next.url)
    } catch (cause) {
      setError(errorText(cause, '保存代理设置失败'))
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setError('')
    setCheck(undefined)
    try {
      setCheck(await apiFetch<ProxyCheck>('/network-proxy/check'))
    } catch (cause) {
      setError(errorText(cause, '代理连接检查失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      title={t('networkProxy')}
      description="用于云端 AI 请求、模型下载和本地运行环境安装。"
    >
      <SettingsRow label="自定义代理" description="关闭时直连；填写后请先保存，再检查连接。">
        <Switch
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.currentTarget.checked)
            setCheck(undefined)
          }}
          disabled={!writable || !saved || busy}
          aria-label="启用自定义代理"
        />
      </SettingsRow>
      {enabled && (
        <SettingsRow label="代理地址">
          <TextInput
            value={url}
            onChange={(event) => {
              setUrl(event.currentTarget.value)
              setCheck(undefined)
            }}
            placeholder="http://127.0.0.1:7890"
            disabled={!writable || !saved || busy}
            aria-label="代理地址"
          />
        </SettingsRow>
      )}
      <SettingsRow label="连接状态">
        <div className="settings-field-stack">
          <div className="settings-field-actions">
            <Button
              onClick={() => void save()}
              disabled={!writable || !saved || !dirty || busy}
              loading={busy}
            >
              保存代理设置
            </Button>
            <Button
              variant="default"
              leftSection={<IconRefresh size={15} />}
              onClick={() => void test()}
              disabled={!saved?.enabled || dirty || busy}
            >
              测试连接
            </Button>
            {saved && (
              <span className="settings-inline-status">{dirty ? '有未保存的更改' : '已保存'}</span>
            )}
          </div>
          {check && <Alert color={check.ready ? 'teal' : 'yellow'}>{check.detail}</Alert>}
          {error && (
            <Alert color="red" icon={<IconAlertCircle size={17} />}>
              {error}
            </Alert>
          )}
        </div>
      </SettingsRow>
    </SettingsCard>
  )
}

export default function StorageSettings() {
  return (
    <div className="settings-stack">
      <ProjectStorageSettings />
      <ArchiveSettings />
      <NetworkProxySettings />
    </div>
  )
}
