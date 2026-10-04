import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Tabs,
  Text,
  Textarea,
  Accordion
} from '@mantine/core'
import { IconAlertCircle, IconCheck, IconDeviceFloppy } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import {
  DEFAULT_IMAGE_DESCRIPTION,
  DEFAULT_IMAGE_PROMPT_EN,
  DEFAULT_IMAGE_TAGS
} from '../../../src/features/ai-workflows/model/imageAIContracts'
import { errorText, SettingsCard, SettingsRow } from './components'
import QwenSettings from './QwenSettings'
import ToolSettings from './ToolSettings'
import { ComfyConnectionSettings, OnlineModelSettings } from './AIServiceSettings'
import type { AIModel } from '../../../src/features/ai-workflows/model/aiServices'
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
  provider: 'local' | 'comfy_cloud'
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
  comfy_api_key_configured: boolean
  comfy_api_key_source: 'saved' | 'environment' | 'none'
}
type ImageConfigPatch = Partial<
  Omit<ImageAIConfig, 'comfy_api_key_configured' | 'comfy_api_key_source'>
>
type SaveImageConfig = (patch: ImageConfigPatch) => Promise<ImageAIConfig>

type CreationDefault = { mode: 'router' | 'workflow'; model: string }
type CreationConfig = {
  defaults: Record<'image_generation' | 'image_edit', CreationDefault>
  mode: 'router' | 'workflow'
  model: string
  concurrency: number
  comfy_api_key_configured: boolean
  comfy_api_key_source: 'saved' | 'environment' | 'none'
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
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = saving || sharedBusy
  const [workflowMessage, setWorkflowMessage] = useState('')

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
    setConfig(saved)
  }, [saved, config])

  function update<K extends keyof ImageAIConfig>(key: K, value: ImageAIConfig[K]) {
    setConfig((current) => (current ? { ...current, [key]: value } : current))
    setSuccess('')
  }

  async function save() {
    if (!config || !writable) return
    if (config.provider === 'comfy_cloud' && !saved?.comfy_api_key_configured) {
      setError('请先在服务连接中配置 Comfy 密钥。')
      return
    }
    if (config.provider === 'comfy_cloud' && config.comfy_mode === 'workflow' && !workflowReady) {
      setError('请导入工作流并完整指定图片、提示词和输出节点。')
      return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const body: ImageConfigPatch =
        config.provider === 'local'
          ? { provider: 'local' }
          : {
              provider: config.provider,
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
      const next = await saveConfig(body)
      setConfig(next)
      setSuccess('内容理解配置已保存')
    } catch (cause) {
      setError(errorText(cause, '保存图片理解服务配置失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard title="内容理解" description="图片描述、提示词反推与标签建议。">
      <SettingsRow label="处理方式">
        <Select
          value={config?.provider === 'local' ? 'local' : config?.comfy_mode || null}
          onChange={(value) => {
            if (!value) return
            setConfig(
              (current) =>
                current && {
                  ...current,
                  provider: value === 'local' ? 'local' : 'comfy_cloud',
                  comfy_mode:
                    value === 'local' ? current.comfy_mode : (value as 'router' | 'workflow')
                }
            )
            setSuccess('')
          }}
          data={[
            { value: 'local', label: '本地模型' },
            { value: 'router', label: 'Comfy Router' },
            { value: 'workflow', label: 'Comfy Cloud 工作流' }
          ]}
          disabled={!writable || !config || busy}
          aria-label="内容理解处理方式"
        />
      </SettingsRow>
      {config?.provider === 'local' && (
        <Text size="sm" c="dimmed" py="sm">
          使用模型管理中的本地视觉语言模型。
        </Text>
      )}
      {config?.provider === 'comfy_cloud' && (
        <>
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
                placeholder="在模型管理中启用模型"
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
              保存内容理解设置
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
    </SettingsCard>
  )
}

function CreationSettings({ models }: { models: RouterModels }) {
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
          defaults: config.defaults,
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
    <SettingsCard title="创作与编辑" description="默认选项用于新的创作会话，已有会话保留当前选择。">
      {(['image_generation', 'image_edit'] as const).map((purpose) => {
        const value = config?.defaults[purpose]
        const updateDefault = (patch: Partial<CreationDefault>) => {
          setConfig(
            (current) =>
              current && {
                ...current,
                defaults: {
                  ...current.defaults,
                  [purpose]: { ...current.defaults[purpose], ...patch }
                }
              }
          )
          setSuccess(false)
        }
        return (
          <SettingsRow
            key={purpose}
            label={purpose === 'image_generation' ? '图片生成' : '图片编辑'}
          >
            <div className="settings-field-stack">
              <Select
                aria-label={`${purpose === 'image_generation' ? '图片生成' : '图片编辑'}处理方式`}
                value={value?.mode || null}
                onChange={(mode) => mode && updateDefault({ mode: mode as 'router' | 'workflow' })}
                data={[
                  { value: 'router', label: 'Comfy Router' },
                  { value: 'workflow', label: 'Comfy Cloud 工作流' }
                ]}
                disabled={!writable || !config || busy}
              />
              {value?.mode === 'router' && (
                <Select
                  searchable
                  aria-label={`${purpose === 'image_generation' ? '图片生成' : '图片编辑'}默认模型`}
                  data={[
                    ...(!models.creation.some((model) => model.id === value.model)
                      ? [{ value: value.model, label: `${value.model} · 当前设置` }]
                      : []),
                    ...models.creation.map((model) => ({ value: model.id, label: model.label }))
                  ]}
                  value={value.model}
                  onChange={(model) => model && updateDefault({ model })}
                  disabled={!writable || busy}
                />
              )}
            </div>
          </SettingsRow>
        )
      })}
      <SettingsRow label="音频、视频">
        <Badge color="gray" variant="light">
          后续接入
        </Badge>
      </SettingsRow>
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
              保存创作设置
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
      title="内容理解提示词"
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
  const [tab, setTab] = useState<string | null>('connections')
  const [catalog, setCatalog] = useState<AIModel[]>([])
  const [saved, setSaved] = useState<ImageAIConfig>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const operation = useRef(false)
  useEffect(() => {
    let active = true
    void Promise.all([
      apiFetch<ImageAIConfig>('/image-ai/config'),
      apiFetch<{ models: AIModel[] }>('/ai/services/models')
    ])
      .then(([config, models]) => {
        if (active) {
          setSaved(config)
          setCatalog(models.models)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取 AI 设置'))
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
  const models: RouterModels = {
    vision: catalog.filter((item) => item.enabled && item.capabilities.includes('understanding')),
    creation: catalog.filter((item) => item.enabled && item.capabilities.includes('generation'))
  }
  return (
    <div className="settings-stack">
      {error && <Alert color="red">{error}</Alert>}
      <Tabs value={tab} onChange={setTab} keepMounted variant="pills" className="settings-ai-tabs">
        <Tabs.List aria-label="AI 设置分区">
          <Tabs.Tab value="connections">服务连接</Tabs.Tab>
          <Tabs.Tab value="models">模型管理</Tabs.Tab>
          <Tabs.Tab value="functions">功能配置</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="connections">
          <ComfyConnectionSettings
            onChange={(value) => {
              setSaved(
                (current) =>
                  current && {
                    ...current,
                    comfy_api_key_configured: value.configured,
                    comfy_api_key_source: value.source
                  }
              )
              setCatalog((current) => current.map((item) => ({ ...item, available: null })))
            }}
          />
        </Tabs.Panel>
        <Tabs.Panel value="models">
          <div className="settings-stack">
            <OnlineModelSettings models={catalog} onModels={setCatalog} />
            <QwenSettings onOpenRuntime={onOpenRuntime} />
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="functions">
          <div className="settings-stack">
            <VisionSettings
              models={models}
              saved={saved}
              saveConfig={saveConfig}
              sharedBusy={busy}
            />
            <Accordion variant="separated">
              <Accordion.Item value="prompts">
                <Accordion.Control>内容理解提示词</Accordion.Control>
                <Accordion.Panel>
                  <PromptSettings saved={saved} saveConfig={saveConfig} busy={busy} />
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
            <CreationSettings models={models} />
            <SettingsCard
              title="专项工具与工作流"
              description="管理消除、抠图、高清化等内置工具，以及自定义工作流。"
            >
              <Button variant="default" onClick={() => setToolsOpen(true)}>
                管理工具与工作流
              </Button>
            </SettingsCard>
          </div>
        </Tabs.Panel>
      </Tabs>
      <Modal
        opened={toolsOpen}
        onClose={() => setToolsOpen(false)}
        title="工具配置"
        size="xl"
        centered
      >
        <ToolSettings />
      </Modal>
    </div>
  )
}
