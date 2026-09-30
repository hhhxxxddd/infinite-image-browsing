import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Text,
  Textarea,
  TextInput
} from '@mantine/core'
import { IconAlertCircle, IconCheck, IconDeviceFloppy } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { useLanguage } from '../../design/i18n'
import {
  DEFAULT_IMAGE_DESCRIPTION,
  DEFAULT_IMAGE_PROMPT_EN,
  DEFAULT_IMAGE_TAGS
} from '../../../src/features/ai-workflows/api/imageAi'
import { errorText, SettingsCard, SettingsRow } from './components'
import QwenSettings from './QwenSettings'
import WorkflowSettings from './WorkflowSettings'
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
  provider: 'local' | 'local_gguf' | 'openrouter' | 'comfy_cloud'
  openrouter_model: string
  gguf_base_url: string
  gguf_model: string
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

function VisionSettings({ models }: { models: RouterModels }) {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [config, setConfig] = useState<ImageAIConfig>()
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const [workflowMessage, setWorkflowMessage] = useState('')
  const [ggufStatus, setGgufStatus] = useState<{ ready: boolean; models: string[] }>()
  const [ggufChecking, setGgufChecking] = useState(false)
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
      setSuccess(false)
    } catch (cause) {
      setError(errorText(cause, '无法读取工作流 JSON'))
    }
  }

  useEffect(() => {
    let active = true
    void apiFetch<ImageAIConfig>('/image-ai/config')
      .then((value) => {
        if (active) setConfig(value)
        if (value.provider === 'local_gguf') {
          void apiFetch<{ ready: boolean; models: string[] }>('/image-ai/gguf/status')
            .then((status) => {
              if (active) setGgufStatus(status)
            })
            .catch(() => {})
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取图片理解服务配置'))
      })
    return () => {
      active = false
    }
  }, [])

  function update<K extends keyof ImageAIConfig>(key: K, value: ImageAIConfig[K]) {
    setConfig((current) => (current ? { ...current, [key]: value } : current))
    setSuccess(false)
  }

  async function checkGGUF() {
    setGgufChecking(true)
    setError('')
    try {
      setGgufStatus(await apiFetch<{ ready: boolean; models: string[] }>('/image-ai/gguf/status'))
    } catch (cause) {
      setError(errorText(cause, '无法测试已保存的 GGUF 连接'))
      setGgufStatus(undefined)
    } finally {
      setGgufChecking(false)
    }
  }

  async function save(clearKey = false) {
    if (!config || !writable) return
    if (config.provider === 'comfy_cloud' && config.comfy_mode === 'workflow' && !workflowReady) {
      setError('请导入工作流并完整指定图片、提示词和输出节点。')
      return
    }
    if (
      (config.provider === 'openrouter' && !config.openrouter_model.trim()) ||
      (config.provider === 'local_gguf' && !config.gguf_base_url.trim()) ||
      Object.values(config.prompts).some((prompt) => !prompt.trim())
    ) {
      setError('请填写服务地址、模型与全部提示词模板后再保存。')
      return
    }
    setBusy(true)
    setError('')
    setSuccess(false)
    try {
      const body = {
        provider: config.provider,
        openrouter_model: config.openrouter_model,
        gguf_base_url: config.gguf_base_url,
        gguf_model: config.gguf_model,
        comfy_model: config.comfy_model,
        comfy_mode: config.comfy_mode,
        comfy_workflow: config.comfy_workflow,
        comfy_workflow_name: config.comfy_workflow_name,
        comfy_image_node_id: config.comfy_image_node_id,
        comfy_image_input: config.comfy_image_input,
        comfy_prompt_node_id: config.comfy_prompt_node_id,
        comfy_prompt_input: config.comfy_prompt_input,
        comfy_output_node_id: config.comfy_output_node_id,
        prompts: config.prompts,
        ...(clearKey
          ? { clear_api_key: true }
          : config.provider === 'openrouter' && apiKey.trim()
            ? { api_key: apiKey.trim() }
            : {})
      }
      const next = await apiFetch<ImageAIConfig>('/image-ai/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      setConfig(next)
      setApiKey('')
      setConfirmClearKey(false)
      setSuccess(true)
      if (next.provider === 'local_gguf') void checkGGUF()
    } catch (cause) {
      setError(errorText(cause, '保存图片理解服务配置失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      title={t('imageUnderstanding')}
      description="用于图片描述、提示词反推与已有标签推荐。"
    >
      <SettingsRow label="服务来源">
        <Select
          value={config?.provider || null}
          onChange={(value) => value && update('provider', value as ImageAIConfig['provider'])}
          data={[
            { value: 'local', label: '本地模型 · Qwen3-VL' },
            { value: 'local_gguf', label: '本地 GGUF 服务' },
            { value: 'openrouter', label: 'OpenRouter' },
            { value: 'comfy_cloud', label: 'Comfy Cloud / Router' }
          ]}
          disabled={!writable || !config || busy}
          aria-label="图片理解服务来源"
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
                configured={config.api_key_configured}
                source={config.api_key_source}
              />
              <PasswordInput
                value={apiKey}
                onChange={(event) => setApiKey(event.currentTarget.value)}
                placeholder="留空保持不变"
                disabled={!writable || busy}
              />
              {config.api_key_source === 'saved' && (
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
      {config?.provider === 'local_gguf' && (
        <>
          <SettingsRow label="服务地址">
            <TextInput
              value={config.gguf_base_url}
              onChange={(event) => update('gguf_base_url', event.currentTarget.value)}
              disabled={!writable || busy}
            />
          </SettingsRow>
          <SettingsRow label="模型名称">
            <TextInput
              value={config.gguf_model}
              onChange={(event) => update('gguf_model', event.currentTarget.value)}
              disabled={!writable || busy}
            />
          </SettingsRow>
          <SettingsRow
            label="已保存的服务连接"
            description="检查当前已保存的地址；未保存的输入不会用于测试。"
          >
            <Group gap="sm">
              <Button
                size="xs"
                variant="default"
                loading={ggufChecking}
                onClick={() => void checkGGUF()}
              >
                测试连接
              </Button>
              <Text size="xs" c={ggufStatus?.ready ? 'teal' : 'dimmed'}>
                {ggufStatus?.ready
                  ? `已连接${ggufStatus.models.length ? ` · ${ggufStatus.models.join('、')}` : ''}`
                  : ggufStatus
                    ? '服务未连接'
                    : '尚未测试'}
              </Text>
            </Group>
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
                placeholder="在 Comfy 连接中查询可用模型"
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
      {config && (
        <SettingsRow label="提示词模板" description="修改后对新的图片理解请求生效。">
          <details className="settings-field-stack">
            <summary>编辑描述、提示词和标签模板</summary>
            <div>
              <Button
                size="xs"
                variant="default"
                onClick={() =>
                  update('prompts', {
                    description: DEFAULT_IMAGE_DESCRIPTION,
                    prompt: DEFAULT_IMAGE_PROMPT_EN,
                    tags: DEFAULT_IMAGE_TAGS
                  })
                }
                disabled={!writable || busy}
              >
                恢复预设
              </Button>
            </div>
            {(['description', 'prompt', 'tags'] as const).map((key) => (
              <Textarea
                key={key}
                label={{ description: '描述', prompt: '提示词反推', tags: '标签推荐' }[key]}
                autosize
                minRows={3}
                maxRows={7}
                maxLength={2000}
                value={config.prompts[key]}
                onChange={(event) =>
                  update('prompts', { ...config.prompts, [key]: event.currentTarget.value })
                }
                disabled={!writable || busy}
              />
            ))}
          </details>
        </SettingsRow>
      )}
      <SettingsRow label="保存配置">
        <div className="settings-field-stack">
          <div>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={() => void save()}
              loading={busy}
              disabled={!writable || !config}
            >
              保存图片理解设置
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
          <Button color="red" loading={busy} disabled={!writable} onClick={() => void save(true)}>
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

  useEffect(() => {
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
  }, [])

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
      description="图片生成与编辑共用接入配置；具体创作方式在编辑器内选择。"
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
            placeholder="在 Comfy 连接中查询可用模型"
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

function ComfyConnectionSettings({ onModels }: { onModels: (models: RouterModels) => void }) {
  const { t } = useLanguage()
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
      setChecked(true)
    } catch (cause) {
      setError(errorText(cause, '无法检查 Comfy 连接'))
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
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
    <SettingsCard
      title={t('comfyConnection')}
      description="图片理解、图片生成与图片编辑共用一个服务密钥。"
    >
      <SettingsRow label="Comfy API Key" description="只在本机保存；留空不会覆盖当前密钥。">
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

export default function AISettings({ onOpenRuntime }: { onOpenRuntime?: () => void }) {
  const [models, setModels] = useState<RouterModels>({ vision: [], creation: [] })
  return (
    <div className="settings-stack">
      <QwenSettings onOpenRuntime={onOpenRuntime} />
      <ComfyConnectionSettings onModels={setModels} />
      <VisionSettings models={models} />
      <CreationSettings models={models} />
      <WorkflowSettings />
    </div>
  )
}
