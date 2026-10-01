import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Tabs,
  Text,
  Textarea,
  TextInput
} from '@mantine/core'
import { IconAlertCircle, IconCheck, IconDeviceFloppy } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { useLanguage } from '../../design/i18n'
import {
  DEFAULT_IMAGE_DESCRIPTION,
  DEFAULT_IMAGE_PROMPT_EN,
  DEFAULT_IMAGE_TAGS
} from '../../../src/features/ai-workflows/model/imageAIContracts'
import { errorText, SettingsCard, SettingsRow } from './components'
import QwenSettings, { type Status as QwenStatus } from './QwenSettings'
import { useSettingsWritable } from './SettingsAccess'

type ComfyWorkflowNode = {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: { title?: string }
}
type ComfyWorkflow = Record<string, ComfyWorkflowNode>
type RouterModels = {
  vision: { id: string; label: string }[]
  creation: { id: string; label: string }[]
}

type ImageAIConfig = {
  provider: 'local' | 'openrouter' | 'comfy_cloud'
  openrouter_model: string
  comfy_model: string
  comfy_mode: 'router' | 'workflow'
  comfy_workflow: ComfyWorkflow | null
  comfy_workflow_name: string
  comfy_image_node_id: string
  comfy_image_input: string
  comfy_prompt_node_id: string
  comfy_prompt_input: string
  comfy_output_node_id: string
  prompts: { description: string; prompt: string; tags: string }
  api_key_configured: boolean
  api_key_source: 'saved' | 'environment' | 'none'
  comfy_api_key_configured: boolean
  comfy_api_key_source: 'saved' | 'environment' | 'none'
}
type ImageConfigPatch = Partial<
  Omit<
    ImageAIConfig,
    'api_key_configured' | 'api_key_source' | 'comfy_api_key_configured' | 'comfy_api_key_source'
  >
> & { api_key?: string; clear_api_key?: boolean }
type SaveImageConfig = (patch: ImageConfigPatch) => Promise<ImageAIConfig>

type CreationConfig = {
  mode: 'router' | 'workflow'
  model: string
  concurrency: number
  comfy_api_key_configured: boolean
  comfy_api_key_source: 'saved' | 'environment' | 'none'
}

function CredentialState({ configured, source }: { configured: boolean; source: string }) {
  return (
    <Badge size="sm" color={configured ? 'teal' : 'gray'} variant="light">
      {configured ? (source === 'environment' ? '环境变量已配置' : '已配置') : '未配置'}
    </Badge>
  )
}

function VisionSettings({
  models,
  saved,
  saveConfig,
  sharedBusy
}: {
  models: RouterModels
  saved?: ImageAIConfig
  saveConfig: SaveImageConfig
  sharedBusy: boolean
}) {
  const writable = useSettingsWritable()
  const [config, setConfig] = useState<ImageAIConfig>()
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = saving || sharedBusy
  const [workflowMessage, setWorkflowMessage] = useState('')
  const [confirmClearKey, setConfirmClearKey] = useState(false)

  const workflowNodes = Object.entries(config?.comfy_workflow || {}).map(([id, node]) => ({
    value: id,
    label: `${id} · ${node._meta?.title || node.class_type}`
  }))
  const workflowInputs = (id: string) =>
    Object.keys(config?.comfy_workflow?.[id]?.inputs || {}).map((name) => ({
      value: name,
      label: name
    }))
  const workflowReady =
    !!config?.comfy_workflow &&
    !!config.comfy_workflow[config.comfy_image_node_id] &&
    workflowInputs(config.comfy_image_node_id).some(
      (input) => input.value === config.comfy_image_input
    ) &&
    !!config.comfy_workflow[config.comfy_prompt_node_id] &&
    workflowInputs(config.comfy_prompt_node_id).some(
      (input) => input.value === config.comfy_prompt_input
    ) &&
    !!config.comfy_workflow[config.comfy_output_node_id]

  async function importWorkflow(file?: File) {
    if (!file || !writable) return
    if (file.size > 1_000_000) {
      setError('工作流 JSON 不能超过 1 MB')
      return
    }
    try {
      const graph: unknown = JSON.parse(await file.text())
      if (
        !graph ||
        Array.isArray(graph) ||
        typeof graph !== 'object' ||
        ('nodes' in graph && 'links' in graph)
      )
        throw new Error('请从 ComfyUI 导出 API 格式 JSON')
      const nodes = Object.entries(graph as Record<string, unknown>)
      if (
        !nodes.length ||
        nodes.length > 256 ||
        nodes.some(
          ([, item]) =>
            !item ||
            typeof item !== 'object' ||
            !('class_type' in item) ||
            !('inputs' in item) ||
            typeof item.inputs !== 'object' ||
            !item.inputs ||
            Array.isArray(item.inputs)
        )
      ) {
        throw new Error('工作流节点无效；请导出 API 格式 JSON')
      }
      const workflow = graph as ComfyWorkflow
      const image = nodes.find(([, item]) => {
        const node = item as ComfyWorkflowNode
        return node.class_type === 'LoadImage' && 'image' in node.inputs
      })
      const prompt = nodes.find(([, item]) => {
        const node = item as ComfyWorkflowNode
        return typeof node.inputs.prompt === 'string' || typeof node.inputs.text === 'string'
      })
      const output = nodes.find(([, item]) =>
        /SaveText|TextOutput|PreviewText|save|output/i.test((item as ComfyWorkflowNode).class_type)
      )
      setConfig((current) =>
        current
          ? {
              ...current,
              comfy_workflow: workflow,
              comfy_workflow_name: file.name,
              comfy_image_node_id: image?.[0] || '',
              comfy_image_input: image ? 'image' : '',
              comfy_prompt_node_id: prompt?.[0] || '',
              comfy_prompt_input: prompt
                ? typeof (prompt[1] as ComfyWorkflowNode).inputs.prompt === 'string'
                  ? 'prompt'
                  : 'text'
                : '',
              comfy_output_node_id: output?.[0] || ''
            }
          : current
      )
      setWorkflowMessage(`已导入 ${nodes.length} 个节点；请确认输入与输出映射后保存。`)
      setError('')
      setSuccess('')
    } catch (cause) {
      setError(errorText(cause, '无法读取工作流 JSON'))
    }
  }

  useEffect(() => {
    if (!saved || config) return
    setConfig({
      ...saved,
      provider: saved.provider === 'openrouter' ? 'openrouter' : 'comfy_cloud'
    })
  }, [saved, config])

  function update<K extends keyof ImageAIConfig>(key: K, value: ImageAIConfig[K]) {
    setConfig((current) => (current ? { ...current, [key]: value } : current))
    setSuccess('')
  }

  async function save(clearKey = false, activate = false) {
    if (!config || !writable) return
    if (
      activate &&
      config.provider === 'openrouter' &&
      !saved?.api_key_configured &&
      !apiKey.trim()
    ) {
      setError('请先配置 OpenRouter 密钥。')
      return
    }
    if (activate && config.provider === 'comfy_cloud' && !saved?.comfy_api_key_configured) {
      setError('请先在上方 Comfy Cloud 中配置密钥。')
      return
    }
    if (config.provider === 'comfy_cloud' && config.comfy_mode === 'workflow' && !workflowReady) {
      setError('请导入工作流并完整指定图片、提示词和输出节点。')
      return
    }
    if (
      (config.provider === 'openrouter' && !config.openrouter_model.trim()) ||
      (config.provider === 'comfy_cloud' && !config.comfy_model)
    ) {
      setError('请选择或填写模型后再保存。')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const body: ImageConfigPatch =
        config.provider === 'openrouter'
          ? {
              openrouter_model: config.openrouter_model,
              ...(clearKey
                ? { clear_api_key: true }
                : apiKey.trim()
                  ? { api_key: apiKey.trim() }
                  : {})
            }
          : {
              comfy_model: config.comfy_model,
              comfy_mode: config.comfy_mode,
              comfy_workflow: config.comfy_workflow,
              comfy_workflow_name: config.comfy_workflow_name,
              comfy_image_node_id: config.comfy_image_node_id,
              comfy_image_input: config.comfy_image_input,
              comfy_prompt_node_id: config.comfy_prompt_node_id,
              comfy_prompt_input: config.comfy_prompt_input,
              comfy_output_node_id: config.comfy_output_node_id
            }
      if (activate) body.provider = config.provider
      const next = await saveConfig(body)
      setConfig({ ...next, provider: config.provider })
      setApiKey('')
      setConfirmClearKey(false)
      setSuccess(activate ? '已启用此图片理解服务' : clearKey ? '已清除密钥' : '服务配置已保存')
    } catch (cause) {
      setError(errorText(cause, '保存图片理解服务配置失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      title="在线图片理解"
      description="配置在线视觉模型，用于描述、提示词反推与标签建议。"
    >
      <SettingsRow label="在线服务">
        <Select
          value={config?.provider || null}
          onChange={(value) => value && update('provider', value as ImageAIConfig['provider'])}
          data={[
            { value: 'comfy_cloud', label: 'Comfy Cloud' },
            { value: 'openrouter', label: 'OpenRouter' }
          ]}
          disabled={!writable || !config || busy}
          aria-label="在线图片理解服务"
        />
      </SettingsRow>
      {config?.provider === 'openrouter' && (
        <>
          <SettingsRow label="OpenRouter 模型">
            <TextInput
              value={config.openrouter_model}
              onChange={(event) => update('openrouter_model', event.currentTarget.value)}
              disabled={!writable || busy}
            />
          </SettingsRow>
          <SettingsRow label="API Key" description="留空可保留已保存的密钥。">
            <div className="settings-field-stack">
              <CredentialState
                configured={saved?.api_key_configured || false}
                source={saved?.api_key_source || 'none'}
              />
              <PasswordInput
                value={apiKey}
                onChange={(event) => setApiKey(event.currentTarget.value)}
                placeholder="留空保持不变"
                disabled={!writable || busy}
              />
              {saved?.api_key_source === 'saved' && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  disabled={!writable || busy}
                  onClick={() => setConfirmClearKey(true)}
                >
                  清除已保存的 Key
                </Button>
              )}
            </div>
          </SettingsRow>
        </>
      )}
      {config?.provider === 'comfy_cloud' && (
        <>
          <SettingsRow label="调用方式">
            <Select
              value={config.comfy_mode}
              onChange={(value) => value && update('comfy_mode', value as 'router' | 'workflow')}
              data={[
                { value: 'router', label: 'Comfy Router' },
                { value: 'workflow', label: 'Comfy 工作流' }
              ]}
              disabled={!writable || busy}
            />
          </SettingsRow>
          {config.comfy_mode === 'router' && (
            <SettingsRow label="模型">
              <Select
                searchable
                data={[
                  ...(!models.vision.some((model) => model.id === config.comfy_model) &&
                  config.comfy_model
                    ? [{ value: config.comfy_model, label: `${config.comfy_model} · 当前设置` }]
                    : []),
                  ...models.vision.map((model) => ({ value: model.id, label: model.label }))
                ]}
                value={config.comfy_model}
                onChange={(value) => value && update('comfy_model', value)}
                disabled={!writable || busy}
                placeholder="在上方 Comfy Cloud 中查询可用模型"
              />
            </SettingsRow>
          )}
          {config.comfy_mode === 'workflow' && (
            <SettingsRow
              label="工作流映射"
              description="导入 ComfyUI 的 API 格式 JSON，按节点匹配输入和输出。"
            >
              <div className="settings-field-stack">
                <Group>
                  <Button component="label" variant="light" disabled={!writable || busy}>
                    导入 API JSON
                    <input
                      type="file"
                      accept="application/json,.json"
                      hidden
                      onChange={(event) => {
                        void importWorkflow(event.currentTarget.files?.[0])
                        event.currentTarget.value = ''
                      }}
                    />
                  </Button>
                  <Text size="xs" c="dimmed">
                    {config.comfy_workflow_name || '未导入'}
                    {workflowNodes.length ? ` · ${workflowNodes.length} 个节点` : ''}
                  </Text>
                </Group>
                {workflowMessage && <Alert color="blue">{workflowMessage}</Alert>}
                {config.comfy_workflow && (
                  <div className="settings-workflow-mapping">
                    <Select
                      label="图片输入节点"
                      searchable
                      disabled={!writable || busy}
                      value={config.comfy_image_node_id || null}
                      data={workflowNodes}
                      onChange={(value) => update('comfy_image_node_id', value || '')}
                    />
                    <Select
                      label="图片输入字段"
                      disabled={!writable || busy}
                      value={config.comfy_image_input || null}
                      data={workflowInputs(config.comfy_image_node_id)}
                      onChange={(value) => update('comfy_image_input', value || '')}
                    />
                    <Select
                      label="提示词节点"
                      searchable
                      disabled={!writable || busy}
                      value={config.comfy_prompt_node_id || null}
                      data={workflowNodes}
                      onChange={(value) => update('comfy_prompt_node_id', value || '')}
                    />
                    <Select
                      label="提示词字段"
                      disabled={!writable || busy}
                      value={config.comfy_prompt_input || null}
                      data={workflowInputs(config.comfy_prompt_node_id)}
                      onChange={(value) => update('comfy_prompt_input', value || '')}
                    />
                    <Select
                      label="输出节点"
                      searchable
                      disabled={!writable || busy}
                      value={config.comfy_output_node_id || null}
                      data={workflowNodes}
                      onChange={(value) => update('comfy_output_node_id', value || '')}
                    />
                  </div>
                )}
                {config.comfy_workflow && (
                  <Text size="xs" c={workflowReady ? 'teal' : 'orange'}>
                    {workflowReady ? '节点映射完整' : '请补齐节点映射'}
                  </Text>
                )}
              </div>
            </SettingsRow>
          )}
        </>
      )}
      <SettingsRow label="保存配置">
        <div className="settings-field-stack">
          <div>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={() => void save()}
              loading={saving}
              disabled={!writable || !config || busy}
            >
              保存服务配置
            </Button>
            <Button
              ml="sm"
              onClick={() => void save(false, true)}
              loading={saving}
              disabled={!writable || !config || busy || saved?.provider === config.provider}
            >
              {config && saved?.provider === config.provider ? '使用中' : '用于图片理解'}
            </Button>
          </div>
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
      <Modal
        opened={confirmClearKey}
        onClose={() => setConfirmClearKey(false)}
        centered
        title="清除 OpenRouter Key"
      >
        <Text size="sm">清除后，OpenRouter 图片理解将无法使用，直到重新配置密钥。</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setConfirmClearKey(false)}>
            取消
          </Button>
          <Button color="red" loading={saving} disabled={!writable} onClick={() => void save(true)}>
            清除 Key
          </Button>
        </Group>
      </Modal>
    </SettingsCard>
  )
}

function CreationSettings({ models }: { models: RouterModels }) {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [config, setConfig] = useState<CreationConfig>()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const configLoaded = !!config

  useEffect(() => {
    if (configLoaded) return
    let active = true
    void apiFetch<CreationConfig>('/image-ai/creation/config')
      .then((value) => {
        if (active) setConfig(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取图片创作配置'))
      })
    return () => {
      active = false
    }
  }, [configLoaded])

  async function save() {
    if (!config || !writable) return
    setBusy(true)
    setError('')
    setSuccess(false)
    try {
      const next = await apiFetch<CreationConfig>('/image-ai/creation/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: config.mode,
          model: config.model,
          concurrency: config.concurrency
        })
      })
      setConfig(next)
      setSuccess(true)
    } catch (cause) {
      setError(errorText(cause, '保存图片创作配置失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      title={t('aiImageCreation')}
      description="设置 Comfy Cloud 图片生成与编辑的默认行为；具体创作方式在编辑器内选择。"
    >
      <SettingsRow label="服务模式">
        <Select
          value={config?.mode || null}
          onChange={(value) =>
            setConfig((current) =>
              current && value ? { ...current, mode: value as 'router' | 'workflow' } : current
            )
          }
          data={[
            { value: 'router', label: 'Comfy Router' },
            { value: 'workflow', label: 'Comfy 工作流' }
          ]}
          disabled={!writable || !config || busy}
        />
      </SettingsRow>
      {config?.mode === 'router' && (
        <SettingsRow label="默认模型">
          <Select
            searchable
            data={[
              ...(!models.creation.some((model) => model.id === config.model) && config.model
                ? [{ value: config.model, label: `${config.model} · 当前设置` }]
                : []),
              ...models.creation.map((model) => ({ value: model.id, label: model.label }))
            ]}
            value={config.model}
            onChange={(value) => value && setConfig({ ...config, model: value })}
            disabled={!writable || busy}
            placeholder="在服务连接中查询可用模型"
          />
        </SettingsRow>
      )}
      <SettingsRow label="并行任务" description="最多同时执行的图片创作任务数。">
        <NumberInput
          value={config?.concurrency || 1}
          onChange={(value) =>
            setConfig((current) =>
              current ? { ...current, concurrency: Number(value) || 1 } : current
            )
          }
          min={1}
          max={15}
          disabled={!writable || !config || busy}
        />
      </SettingsRow>
      <SettingsRow label="保存配置">
        <div className="settings-field-stack">
          <div>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={() => void save()}
              loading={busy}
              disabled={!writable || !config}
            >
              保存图片创作设置
            </Button>
          </div>
          {success && (
            <Alert color="teal" icon={<IconCheck size={17} />}>
              设置已保存
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
  )
}

function ComfyConnectionSettings({
  onModels,
  onCredentials
}: {
  onModels: (models: RouterModels) => void
  onCredentials: (
    credentials: Pick<ImageAIConfig, 'comfy_api_key_configured' | 'comfy_api_key_source'>
  ) => void
}) {
  const writable = useSettingsWritable()
  const [status, setStatus] = useState<{ ready: boolean; detail: string }>()
  const [checked, setChecked] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [keySource, setKeySource] = useState<'saved' | 'environment' | 'none'>('none')
  const [keyDraft, setKeyDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [modelCount, setModelCount] = useState(0)
  const firstCheck = useRef(false)

  async function check() {
    setChecked(false)
    setBusy('status')
    setError('')
    try {
      const [nextStatus, config] = await Promise.all([
        apiFetch<{ ready: boolean; detail: string }>('/image-ai/comfy/status'),
        apiFetch<CreationConfig>('/image-ai/creation/config')
      ])
      setStatus(nextStatus)
      setConfigured(config.comfy_api_key_configured)
      setKeySource(config.comfy_api_key_source)
      onCredentials({
        comfy_api_key_configured: config.comfy_api_key_configured,
        comfy_api_key_source: config.comfy_api_key_source
      })
      setChecked(true)
    } catch (cause) {
      setError(errorText(cause, '无法检查 Comfy 连接'))
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    if (firstCheck.current) return
    firstCheck.current = true
    void check()
  }, [])

  async function loadModels() {
    setBusy('models')
    setError('')
    try {
      const value = await apiFetch<RouterModels>('/image-ai/comfy/models')
      onModels(value)
      setModelCount(value.vision.length + value.creation.length)
    } catch (cause) {
      setError(errorText(cause, '无法查询 Comfy Router 模型'))
    } finally {
      setBusy('')
    }
  }

  async function saveKey(clear: boolean) {
    if (!writable) return
    setBusy('key')
    setError('')
    try {
      const current = await apiFetch<CreationConfig>('/image-ai/creation/config')
      await apiFetch<CreationConfig>('/image-ai/creation/config', {
        method: 'PUT',
        body: JSON.stringify({
          mode: current.mode,
          model: current.model,
          concurrency: current.concurrency,
          ...(clear ? { clear_comfy_api_key: true } : { comfy_api_key: keyDraft.trim() })
        })
      })
      setKeyDraft('')
      onModels({ vision: [], creation: [] })
      setModelCount(0)
      setConfirmClear(false)
      setBusy('')
      await check()
    } catch (cause) {
      setError(errorText(cause, clear ? '清除 Comfy 密钥失败' : '保存 Comfy 密钥失败'))
      setBusy('')
    }
  }

  return (
    <SettingsCard title="Comfy Cloud" description="配置访问密钥、检查连接并获取可用模型。">
      <SettingsRow
        label="Comfy API Key"
        description="通过 Comfy 调用的图片理解与创作共用此密钥；留空保留已保存的密钥。"
      >
        <div className="settings-field-stack">
          {checked ? (
            <CredentialState configured={configured} source={keySource} />
          ) : (
            <Badge size="sm" color="gray" variant="light">
              {error ? '状态未知' : '检查中…'}
            </Badge>
          )}
          <PasswordInput
            aria-label="Comfy API Key"
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.currentTarget.value)}
            placeholder="输入新密钥"
            disabled={!writable || !!busy}
          />
          <Group gap="xs">
            <Button
              size="xs"
              disabled={!writable || !keyDraft.trim() || !!busy}
              loading={busy === 'key'}
              onClick={() => void saveKey(false)}
            >
              保存密钥
            </Button>
            {configured && keySource === 'saved' && (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                disabled={!writable || !!busy}
                onClick={() => setConfirmClear(true)}
              >
                清除已保存密钥
              </Button>
            )}
          </Group>
        </div>
      </SettingsRow>
      <SettingsRow label="连接状态">
        <Group gap="sm">
          <Badge variant="light" color={!checked ? 'gray' : status?.ready ? 'teal' : 'orange'}>
            {!checked
              ? error
                ? '状态未知'
                : '检查中…'
              : status?.ready
                ? '已连接'
                : configured
                  ? '已配置，待验证'
                  : '未配置'}
          </Badge>
          <Button
            size="xs"
            variant="default"
            loading={busy === 'status'}
            onClick={() => void check()}
          >
            检查连接
          </Button>
          {status?.detail && (
            <Text size="xs" c="dimmed">
              {status.detail}
            </Text>
          )}
        </Group>
      </SettingsRow>
      <SettingsRow label="Router 模型目录" description="查询服务端可用的视觉模型和创作模型。">
        <Group gap="sm">
          <Button
            size="xs"
            variant="light"
            loading={busy === 'models'}
            onClick={() => void loadModels()}
          >
            查询模型
          </Button>
          <Text size="xs" c="dimmed">
            {modelCount ? `已加载 ${modelCount} 个模型` : '尚未查询'}
          </Text>
        </Group>
      </SettingsRow>
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} mt="sm">
          {error}
        </Alert>
      )}
      <Modal
        opened={confirmClear}
        onClose={() => setConfirmClear(false)}
        centered
        title="清除 Comfy 密钥"
      >
        <Text size="sm">清除后，图片理解与创作将无法调用 Comfy，直到重新配置密钥。</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setConfirmClear(false)}>
            取消
          </Button>
          <Button
            color="red"
            loading={busy === 'key'}
            disabled={!writable}
            onClick={() => void saveKey(true)}
          >
            清除密钥
          </Button>
        </Group>
      </Modal>
    </SettingsCard>
  )
}

function PromptSettings({
  saved,
  saveConfig,
  busy
}: {
  saved?: ImageAIConfig
  saveConfig: SaveImageConfig
  busy: boolean
}) {
  const writable = useSettingsWritable()
  const [prompts, setPrompts] = useState<ImageAIConfig['prompts']>()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  useEffect(() => {
    if (saved && !prompts) setPrompts(saved.prompts)
  }, [saved, prompts])
  async function save() {
    if (!prompts || !writable) return
    setError('')
    setSuccess(false)
    try {
      const next = await saveConfig({ prompts })
      setPrompts(next.prompts)
      setSuccess(true)
    } catch (cause) {
      setError(errorText(cause, '无法保存提示词模板'))
    }
  }
  return (
    <SettingsCard
      title="图片理解模板"
      description="描述、提示词反推与标签建议共用这些模板；切换服务会保留模板。"
    >
      <div className="settings-ai-prompts">
        {(['description', 'prompt', 'tags'] as const).map((key) => (
          <Textarea
            key={key}
            label={{ description: '描述', prompt: '提示词反推', tags: '标签建议' }[key]}
            autosize
            minRows={3}
            maxRows={7}
            maxLength={2000}
            value={prompts?.[key] || ''}
            disabled={!writable || !prompts || busy}
            onChange={(event) => {
              const value = event.currentTarget.value
              setPrompts((current) => current && { ...current, [key]: value })
              setSuccess(false)
            }}
          />
        ))}
        <Group>
          <Button
            onClick={() => void save()}
            loading={busy}
            disabled={
              !writable ||
              !prompts ||
              Object.values(prompts).some((value) => !value.trim()) ||
              JSON.stringify(prompts) === JSON.stringify(saved?.prompts)
            }
          >
            保存模板
          </Button>
          <Button
            variant="default"
            disabled={!writable || busy || !prompts}
            onClick={() => {
              setPrompts({
                description: DEFAULT_IMAGE_DESCRIPTION,
                prompt: DEFAULT_IMAGE_PROMPT_EN,
                tags: DEFAULT_IMAGE_TAGS
              })
              setSuccess(false)
            }}
          >
            恢复预设
          </Button>
          {success && (
            <Text size="sm" c="teal">
              模板已保存
            </Text>
          )}
        </Group>
        {error && <Alert color="red">{error}</Alert>}
      </div>
    </SettingsCard>
  )
}

export default function AISettings({ onOpenRuntime }: { onOpenRuntime?: () => void }) {
  const writable = useSettingsWritable()
  const [tab, setTab] = useState<string | null>('local')
  const [models, setModels] = useState<RouterModels>({ vision: [], creation: [] })
  const [saved, setSaved] = useState<ImageAIConfig>()
  const [instruct, setInstruct] = useState<QwenStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const operation = useRef(false)
  useEffect(() => {
    let active = true
    void apiFetch<ImageAIConfig>('/image-ai/config')
      .then((config) => {
        if (active) {
          setSaved(config)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取 AI 接入配置'))
      })
    return () => {
      active = false
    }
  }, [])
  const saveConfig = useCallback(
    async (patch: ImageConfigPatch) => {
      if (!writable) throw new Error('当前环境只允许查看配置')
      if (operation.current) throw new Error('正在保存配置，请稍后重试')
      operation.current = true
      setBusy(true)
      try {
        const next = await apiFetch<ImageAIConfig>('/image-ai/config', {
          method: 'PATCH',
          body: JSON.stringify(patch)
        })
        setSaved(next)
        setError('')
        return next
      } finally {
        operation.current = false
        setBusy(false)
      }
    },
    [writable]
  )
  const current = !saved
    ? '读取中…'
    : saved.provider === 'local'
      ? `本地 ${instruct?.model.split('/').pop() || 'Qwen3-VL'}`
      : saved.provider === 'openrouter'
        ? `OpenRouter · ${saved.openrouter_model}`
        : `Comfy Cloud · ${saved.comfy_mode === 'workflow' ? saved.comfy_workflow_name || '视觉工作流' : saved.comfy_model}`
  function configureCurrent() {
    setTab(saved?.provider === 'local' ? 'local' : 'connections')
  }
  return (
    <div className="settings-stack">
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}
      <div className="settings-ai-current" role="status">
        <div>
          <Text size="xs" c="dimmed">
            当前图片理解服务
          </Text>
          <Text size="sm" fw={600}>
            {current}
          </Text>
        </div>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          onClick={configureCurrent}
          disabled={!saved}
        >
          配置此服务
        </Button>
      </div>
      <Tabs value={tab} onChange={setTab} keepMounted variant="pills" className="settings-ai-tabs">
        <Tabs.List aria-label="AI 接入分区">
          <Tabs.Tab value="local">本地模型</Tabs.Tab>
          <Tabs.Tab value="connections">服务连接</Tabs.Tab>
          <Tabs.Tab value="usage">使用设置</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="local">
          <QwenSettings
            onOpenRuntime={onOpenRuntime}
            visionProvider={saved?.provider}
            visionBusy={busy || !saved}
            onInstructStatus={setInstruct}
            onUseForVision={() => saveConfig({ provider: 'local' })}
          />
        </Tabs.Panel>
        <Tabs.Panel value="connections">
          <div className="settings-stack">
            <ComfyConnectionSettings
              onModels={setModels}
              onCredentials={(credentials) =>
                setSaved((current) => current && { ...current, ...credentials })
              }
            />
            <VisionSettings
              models={models}
              saved={saved}
              saveConfig={saveConfig}
              sharedBusy={busy}
            />
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="usage">
          <div className="settings-stack">
            <PromptSettings saved={saved} saveConfig={saveConfig} busy={busy} />
            <CreationSettings models={models} />
          </div>
        </Tabs.Panel>
      </Tabs>
    </div>
  )
}
