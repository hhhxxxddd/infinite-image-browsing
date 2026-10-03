import { Alert, Button, Switch, TextInput } from '@mantine/core'
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { useLanguage } from '../../design/i18n'
import { errorText, SettingsCard, SettingsRow } from './components'
import ApplicationStorageSettings from './ApplicationStorageSettings'
import { useSettingsWritable } from './SettingsAccess'

type ProxySettings = { enabled: boolean; url: string }
type ProxyCheck = { ready: boolean; detail: string }

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
      <ApplicationStorageSettings />
      <NetworkProxySettings />
    </div>
  )
}
