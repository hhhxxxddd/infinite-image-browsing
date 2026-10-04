import {
  upscaleResolutions,
  type UpscaleResolution
} from '../../../src/features/image-editor/model/imageStudioUpscale'
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  Tooltip
} from '@mantine/core'
import { useEffect, useState } from 'react'
import type { StudioWorkflowPresetInput } from '../../../src/features/ai-workflows/model/imageAIContracts'
import { apiFetch } from '../../shared/apiClient'
import { useNotice } from '../../shared/notices'
import EditorParameterSlider from '../editors/EditorParameterSlider'
import { errorText, SettingsCard } from './components'
import {
  emptyEraseDraft,
  eraseAlignedSize,
  type EraseSettings
} from '../../../src/features/image-editor/model/imageStudioErase'

type Defaults = Partial<EraseSettings> & {
  refine_iterations?: number
  trim_transparent?: boolean
  target_resolution?: UpscaleResolution
}

type Tool = {
  id: string
  name: string
  engine?: string
  version?: number
  status: 'available' | 'coming_soon'
  connection_configured?: boolean
  defaults?: Defaults
  factory_defaults?: Defaults
}

export default function BuiltinToolSettings({
  onCopy,
  copyDisabled
}: {
  onCopy: (preset: StudioWorkflowPresetInput) => void
  copyDisabled: boolean
}) {
  const [tools, setTools] = useState<Tool[]>([])
  const [selected, setSelected] = useState('image-cutout-sam3')
  const [readonly, setReadonly] = useState(true)
  const [refinement, setRefinement] = useState(3)
  const [trimTransparent, setTrimTransparent] = useState(false)
  const [resolution, setResolution] = useState<UpscaleResolution>('4K')
  const [erase, setErase] = useState<EraseSettings>(() => {
    const { prompt, blend_pixels, output_width, output_height } = emptyEraseDraft()
    return { prompt, blend_pixels, output_width, output_height }
  })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [details, setDetails] = useState<StudioWorkflowPresetInput>()
  const notice = useNotice()
  const tool = tools.find((item) => item.id === selected)
  useEffect(() => {
    let active = true
    void Promise.all([
      apiFetch<Tool[]>('/ai-tools/builtin'),
      apiFetch<{ is_readonly: boolean }>('/global_setting')
    ])
      .then(([items, global]) => {
        if (!active) return
        setTools(items)
        setRefinement(
          items.find((item) => item.id === 'image-cutout-sam3')?.defaults?.refine_iterations ?? 3
        )
        setTrimTransparent(
          items.find((item) => item.id === 'image-cutout-sam3')?.defaults?.trim_transparent ?? false
        )
        setReadonly(global.is_readonly)
        setResolution(
          items.find((item) => item.id === 'image-upscale')?.defaults?.target_resolution ?? '4K'
        )
        const eraseDefaults = items.find((item) => item.id === 'image-erase')?.defaults
        if (eraseDefaults) setErase((value) => ({ ...value, ...eraseDefaults }))
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '读取内置工具失败'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function save() {
    if (!tool || readonly || busy) return
    setBusy(true)
    setError('')
    try {
      const defaults = await apiFetch<NonNullable<Tool['defaults']>>(
        `/ai-tools/builtin/${tool.id}/defaults`,
        {
          method: 'PUT',
          body: JSON.stringify(
            tool.id === 'image-erase'
              ? erase
              : tool.id === 'image-upscale'
                ? { target_resolution: resolution }
                : { refine_iterations: refinement, trim_transparent: trimTransparent }
          )
        }
      )
      setTools((items) => items.map((item) => (item.id === tool.id ? { ...item, defaults } : item)))
      // Notify open editors without touching their current selection or in-flight jobs.
      const channel = new BroadcastChannel('omnigallery:builtin-tools')
      channel.postMessage({ type: 'defaults-changed' })
      channel.close()
      notice('默认参数已保存，媒体库与所有工作区共用。')
    } catch (cause) {
      setError(errorText(cause, '保存默认参数失败'))
    } finally {
      setBusy(false)
    }
  }

  async function readWorkflow(copy: boolean) {
    if (!tool || busy || (copy && (readonly || copyDisabled))) return
    setBusy(true)
    setError('')
    try {
      const preset = await apiFetch<StudioWorkflowPresetInput>(
        `/ai-tools/builtin/${tool.id}/workflow`
      )
      if (copy) onCopy(preset)
      else setDetails(preset)
    } catch (cause) {
      setError(errorText(cause, '读取内置流程失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard title="内置工具">
      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}
      {loading ? (
        <Text size="sm" c="dimmed">
          正在读取工具…
        </Text>
      ) : (
        <div className="settings-workflow-layout">
          <aside className="settings-workflow-list" aria-label="内置工具列表">
            {tools.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-workflow-item${selected === item.id ? ' is-active' : ''}`}
                aria-pressed={selected === item.id}
                onClick={() => setSelected(item.id)}
              >
                <span>{item.name}</span>
                <Badge
                  size="xs"
                  variant="light"
                  color={item.status === 'available' ? 'blue' : 'gray'}
                >
                  {item.status === 'available' ? item.engine : '未开放'}
                </Badge>
              </button>
            ))}
          </aside>
          <div className="settings-workflow-editor">
            {tool?.status === 'available' ? (
              <Stack gap="lg" maw={600}>
                <Group justify="space-between">
                  <Group gap="xs">
                    <Text fw={600}>{tool.name}</Text>
                    <Badge variant="outline">
                      {tool.engine} · v{tool.version}
                    </Badge>
                  </Group>
                  <Badge color={tool.connection_configured ? 'teal' : 'orange'} variant="light">
                    {tool.connection_configured ? '服务已配置' : '服务未配置'}
                  </Badge>
                </Group>
                {!tool.connection_configured && (
                  <Text size="sm" c="dimmed">
                    请在系统设置中配置 Comfy Cloud 连接。
                  </Text>
                )}
                <Stack gap="sm">
                  <Text size="sm" fw={600}>
                    默认参数
                  </Text>
                  {tool.id === 'image-erase' ? (
                    <>
                      <NumberInput
                        label="边缘融合"
                        min={0}
                        max={256}
                        allowDecimal={false}
                        value={erase.blend_pixels}
                        disabled={readonly || busy}
                        onChange={(v) => {
                          if (typeof v === 'number') setErase({ ...erase, blend_pixels: v })
                        }}
                      />
                      <Group grow>
                        <NumberInput
                          label="处理宽度 px"
                          min={64}
                          max={4096}
                          step={32}
                          allowDecimal={false}
                          value={erase.output_width}
                          disabled={readonly || busy}
                          onChange={(v) => {
                            if (typeof v === 'number') setErase({ ...erase, output_width: v })
                          }}
                          onBlur={() =>
                            setErase({
                              ...erase,
                              output_width: eraseAlignedSize(erase.output_width)
                            })
                          }
                        />
                        <NumberInput
                          label="处理高度 px"
                          min={64}
                          max={4096}
                          step={32}
                          allowDecimal={false}
                          value={erase.output_height}
                          disabled={readonly || busy}
                          onChange={(v) => {
                            if (typeof v === 'number') setErase({ ...erase, output_height: v })
                          }}
                          onBlur={() =>
                            setErase({
                              ...erase,
                              output_height: eraseAlignedSize(erase.output_height)
                            })
                          }
                        />
                      </Group>
                      <Textarea
                        label="默认提示词"
                        minRows={3}
                        autosize
                        value={erase.prompt}
                        maxLength={4000}
                        disabled={readonly || busy}
                        onChange={(e) => setErase({ ...erase, prompt: e.currentTarget.value })}
                      />
                    </>
                  ) : tool.id === 'image-upscale' ? (
                    <Group justify="space-between">
                      <Text size="sm">短边尺寸</Text>
                      <SegmentedControl
                        size="xs"
                        value={resolution}
                        aria-label="默认高清化短边尺寸"
                        disabled={readonly || busy}
                        data={upscaleResolutions}
                        onChange={(value) => setResolution(value as UpscaleResolution)}
                      />
                    </Group>
                  ) : (
                    <>
                      <EditorParameterSlider
                        label="边缘精修"
                        value={refinement}
                        resetValue={tool.factory_defaults?.refine_iterations ?? 3}
                        min={0}
                        max={5}
                        step={1}
                        formatValue={(value) => `${value} 次`}
                        disabled={readonly || busy}
                        onChange={setRefinement}
                      />
                      <Switch
                        size="xs"
                        label="按边缘裁剪"
                        checked={trimTransparent}
                        disabled={readonly || busy}
                        onChange={(event) => setTrimTransparent(event.currentTarget.checked)}
                      />
                    </>
                  )}
                  <Group justify="flex-end">
                    <Button
                      size="xs"
                      loading={busy}
                      disabled={
                        readonly ||
                        (tool.id === 'image-erase'
                          ? !erase.prompt.trim() ||
                            JSON.stringify(erase) === JSON.stringify(tool.defaults)
                          : tool.id === 'image-upscale'
                            ? resolution === tool.defaults?.target_resolution
                            : refinement === tool.defaults?.refine_iterations &&
                              trimTransparent === tool.defaults?.trim_transparent)
                      }
                      onClick={() => void save()}
                    >
                      保存默认参数
                    </Button>
                  </Group>
                </Stack>
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={busy}
                    onClick={() => void readWorkflow(false)}
                  >
                    查看内置流程
                  </Button>
                  <Tooltip label="请先保存自定义工作流中的更改" disabled={!copyDisabled}>
                    <span>
                      <Button
                        size="xs"
                        variant="subtle"
                        disabled={readonly || busy || copyDisabled}
                        onClick={() => void readWorkflow(true)}
                      >
                        复制为自定义工作流
                      </Button>
                    </span>
                  </Tooltip>
                </Group>
              </Stack>
            ) : (
              tool && (
                <div className="settings-workflow-empty">
                  <Text fw={600}>{tool.name}</Text>
                  <Text size="sm" c="dimmed">
                    暂未开放
                  </Text>
                </div>
              )
            )}
          </div>
        </div>
      )}
      <Modal
        opened={!!details}
        onClose={() => setDetails(undefined)}
        title="内置工具流程 · 只读"
        size="lg"
      >
        <Text size="sm" c="dimmed" mb="sm">
          {details?.workflow['8']?.class_type === 'InpaintCropImproved'
            ? '图片 + 涂抹遮罩 + 参考范围 → Qwen2.1 局部重绘 → 贴回图片图层；自定义副本使用自动参考范围。'
            : details?.workflow['4:14']
              ? '单张图片 + 短边尺寸 → SeedVR2 高清化 → 替换图片图层（保留透明通道）'
              : '单张图片 + 点选或框选 → 主体遮罩 → 透明图片图层'}
        </Text>
        <Code block mah="60vh" style={{ overflow: 'auto' }}>
          {JSON.stringify(details?.workflow, null, 2)}
        </Code>
      </Modal>
    </SettingsCard>
  )
}
