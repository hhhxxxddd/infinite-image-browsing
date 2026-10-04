import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  PasswordInput,
  Select,
  Switch,
  Text,
  TextInput
} from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { errorText, SettingsCard, SettingsRow } from './components'
import { useSettingsWritable } from './SettingsAccess'

import type { AIConnection, AIModel } from '../../../src/features/ai-workflows/model/aiServices'

const capabilities = {
  understanding: '内容理解',
  generation: '生成',
  editing: '编辑',
  processing: '专项处理'
}

export function ComfyConnectionSettings({ onChange }: { onChange: (value: AIConnection) => void }) {
  const writable = useSettingsWritable()
  const [connection, setConnection] = useState<AIConnection>()
  const [draft, setDraft] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<Record<string, { ready: boolean; detail: string }>>({})
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    let active = true
    void apiFetch<AIConnection>('/ai/services/comfy')
      .then((value) => {
        if (active) setConnection(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取服务连接'))
      })
    return () => {
      active = false
    }
  }, [])
  async function save(clear = false) {
    if (!writable) return
    setBusy(true)
    setError('')
    try {
      const next = await apiFetch<AIConnection>('/ai/services/comfy', {
        method: 'PUT',
        body: JSON.stringify(clear ? { clear_api_key: true } : { api_key: draft.trim() })
      })
      setConnection(next)
      onChange(next)
      setDraft('')
      setStatus({})
      setConfirm(false)
    } catch (cause) {
      setError(errorText(cause, '保存连接失败'))
    } finally {
      setBusy(false)
    }
  }
  async function check() {
    setChecking(true)
    const channels = ['router', 'workflow']
    const results = await Promise.allSettled(
      channels.map((channel) =>
        apiFetch<{ ready: boolean; detail: string }>(`/ai/services/comfy/status/${channel}`)
      )
    )
    setStatus(
      Object.fromEntries(
        results.map((result, i) => [
          channels[i],
          result.status === 'fulfilled'
            ? result.value
            : { ready: false, detail: errorText(result.reason, '连接检查失败') }
        ])
      )
    )
    setChecking(false)
  }
  return (
    <SettingsCard title="Comfy" description="Router 模型接口与 Cloud 工作流共用此连接。">
      <SettingsRow label="API Key" description="留空保持已保存的密钥。">
        <div className="settings-field-stack">
          <Badge size="sm" variant="light" color={connection?.configured ? 'teal' : 'gray'}>
            {!connection
              ? '读取中…'
              : connection.configured
                ? connection.source === 'environment'
                  ? '环境变量已配置'
                  : '已配置'
                : '未配置'}
          </Badge>
          <PasswordInput
            aria-label="Comfy API Key"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="输入新密钥"
            disabled={!writable || busy || checking}
          />
          <Group gap="xs">
            <Button
              size="xs"
              onClick={() => void save()}
              loading={busy}
              disabled={!writable || !draft.trim() || checking}
            >
              保存密钥
            </Button>
            {connection?.source === 'saved' && (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                onClick={() => setConfirm(true)}
                disabled={!writable || busy || checking}
              >
                清除已保存密钥
              </Button>
            )}
          </Group>
        </div>
      </SettingsRow>
      {(
        [
          ['router', 'Router 模型接口'],
          ['workflow', 'Cloud 工作流']
        ] as const
      ).map(([channel, title]) => (
        <SettingsRow key={channel} label={title}>
          <Group gap="sm">
            <Badge
              variant="light"
              color={status[channel]?.ready ? 'teal' : status[channel] ? 'orange' : 'gray'}
            >
              {checking
                ? '检查中…'
                : status[channel]
                  ? status[channel].ready
                    ? '已连接'
                    : '未连接'
                  : '未检查'}
            </Badge>
            {status[channel] && !checking && (
              <Text size="xs" c="dimmed">
                {status[channel].detail}
              </Text>
            )}
          </Group>
        </SettingsRow>
      ))}
      <Group mt="sm">
        <Button
          variant="default"
          size="xs"
          onClick={() => void check()}
          loading={checking}
          disabled={!connection?.configured || busy}
        >
          检查连接
        </Button>
      </Group>
      {error && (
        <Alert color="red" mt="sm">
          {error}
        </Alert>
      )}
      <Modal opened={confirm} onClose={() => setConfirm(false)} centered title="清除 Comfy 密钥">
        <Text size="sm">
          使用此连接的功能将无法调用 Comfy。若设置了环境变量密钥，将继续使用环境变量。
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setConfirm(false)}>
            取消
          </Button>
          <Button color="red" onClick={() => void save(true)} loading={busy} disabled={!writable}>
            清除密钥
          </Button>
        </Group>
      </Modal>
    </SettingsCard>
  )
}

export function OnlineModelSettings({
  models,
  onModels
}: {
  models: AIModel[]
  onModels: (models: AIModel[]) => void
}) {
  const writable = useSettingsWritable()
  const [search, setSearch] = useState('')
  const [media, setMedia] = useState('all')
  const [capability, setCapability] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function refresh() {
    setBusy(true)
    setError('')
    try {
      onModels((await apiFetch<{ models: AIModel[] }>('/ai/services/models?refresh=true')).models)
    } catch (cause) {
      setError(errorText(cause, '查询在线模型失败'))
    } finally {
      setBusy(false)
    }
  }
  async function toggle(id: string, enabled: boolean) {
    if (!writable || busy) return
    setBusy(true)
    setError('')
    try {
      const next = models.map((item) => (item.id === id ? { ...item, enabled } : item))
      await apiFetch('/ai/services/models', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: next.filter((item) => item.enabled).map((item) => item.id)
        })
      })
      onModels(next)
    } catch (cause) {
      setError(errorText(cause, '保存模型选择失败'))
    } finally {
      setBusy(false)
    }
  }
  const filtered = models.filter(
    (item) =>
      `${item.id} ${item.label}`.toLowerCase().includes(search.trim().toLowerCase()) &&
      (media === 'all' || item.media.some((value) => value === media)) &&
      (capability === 'all' || item.capabilities.some((value) => value === capability))
  )
  return (
    <SettingsCard
      title="在线模型"
      description="启用后出现在功能的模型选择器中；这里仅列出已适配的模型。"
      actions={
        <Button size="xs" variant="default" onClick={() => void refresh()} loading={busy}>
          查询可用状态
        </Button>
      }
    >
      <div className="settings-ai-model-filters">
        <TextInput
          aria-label="搜索在线模型"
          placeholder="搜索模型"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          leftSection={<IconSearch size={16} />}
        />
        <Select
          aria-label="媒体类型"
          value={media}
          onChange={(value) => setMedia(value || 'all')}
          data={[
            { value: 'all', label: '全部类型' },
            { value: 'text', label: '文字' },
            { value: 'image', label: '图片' },
            { value: 'audio', label: '音频' },
            { value: 'video', label: '视频' }
          ]}
        />
        <Select
          aria-label="模型能力"
          value={capability}
          onChange={(value) => setCapability(value || 'all')}
          data={[
            { value: 'all', label: '全部能力' },
            ...Object.entries(capabilities).map(([value, label]) => ({ value, label }))
          ]}
        />
      </div>
      <div className="settings-ai-model-list">
        {filtered.map((item) => (
          <div className="settings-ai-model" key={item.id}>
            <div>
              <Text size="sm" fw={600}>
                {item.label}
              </Text>
              <Text size="xs" c="dimmed" className="settings-ai-model-id">
                {item.id}
              </Text>
              <Group gap={5} mt={5}>
                {item.capabilities.map((value) => (
                  <Badge key={value} size="xs" variant="light" color="gray">
                    {capabilities[value]}
                  </Badge>
                ))}
                {item.available !== null && (
                  <Badge size="xs" variant="light" color={item.available ? 'teal' : 'orange'}>
                    {item.available ? '目录可用' : '目录未返回'}
                  </Badge>
                )}
              </Group>
            </div>
            <Switch
              aria-label={`启用 ${item.label}`}
              checked={item.enabled}
              onChange={(event) => void toggle(item.id, event.currentTarget.checked)}
              disabled={!writable || busy}
            />
          </div>
        ))}
        {!filtered.length && (
          <Text size="sm" c="dimmed" py="lg">
            {media === 'audio' || media === 'video' ? '该类型暂未接入在线模型' : '没有匹配的模型'}
          </Text>
        )}
      </div>
      {error && (
        <Alert color="red" mt="sm">
          {error}
        </Alert>
      )}
    </SettingsCard>
  )
}
