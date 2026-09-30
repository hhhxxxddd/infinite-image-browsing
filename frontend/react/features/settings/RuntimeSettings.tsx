import { Alert, Badge, Button, Group, Progress, Select, Text } from '@mantine/core'
import { IconAlertCircle, IconDownload, IconRefresh } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { useLanguage } from '../../design/i18n'
import { errorText, SettingsCard } from './components'
import { useSettingsWritable } from './SettingsAccess'

type RuntimeJob = { running: boolean; stage: string; error: string; progress: number }
type MediaRuntimeStatus = {
  supported: boolean
  ready: boolean
  source: 'managed' | 'system' | 'missing'
  path: string
  version: string
  ffprobe_version: string
  managed_installed: boolean
  recipe: string
  update_available: boolean
  job: RuntimeJob
}
type AIRuntimeStatus = {
  supported: boolean
  installed: boolean
  path: string
  recipe: string
  update_available: boolean
  variant: 'cpu' | 'cu128'
  check: { ready?: boolean; device?: string; detail?: string; versions?: Record<string, string> }
  job: RuntimeJob
}

function MediaRuntime() {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [state, setState] = useState<MediaRuntimeStatus>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const busy = pending || !!state?.job.running

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const value = await apiFetch<MediaRuntimeStatus>('/media-runtime')
        if (active) {
          setState(value)
          setError('')
        }
      } catch (cause) {
        if (active) setError(errorText(cause, '无法读取 FFmpeg 状态'))
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      if (!document.hidden && (state?.job.running || error)) void refresh()
    }, 2500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [state?.job.running, error])

  async function run(action: 'check' | 'install') {
    if (action === 'install' && !writable) return
    setPending(true)
    setError('')
    try {
      setState(await apiFetch<MediaRuntimeStatus>(`/media-runtime/${action}`, { method: 'POST' }))
    } catch (cause) {
      setError(errorText(cause, '无法启动 FFmpeg 任务'))
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsCard
      title={t('ffmpegRuntime')}
      description="音频试听、混音与导出，以及视频 MP4 导出使用同一套 FFmpeg / ffprobe。媒体浏览仍由 WebView 解码。"
      actions={
        <Badge color={state?.ready ? 'teal' : 'gray'} variant="light">
          {state?.job.running ? state.job.stage : state?.ready ? '可用' : '未就绪'}
        </Badge>
      }
    >
      <div className="settings-field-stack" style={{ paddingTop: 12 }}>
        <Text size="sm">
          {state?.ready
            ? `当前使用${state.source === 'managed' ? '应用管理版本' : '系统版本'} · FFmpeg ${state.version}`
            : state
              ? '未找到可用的 FFmpeg 与 ffprobe。'
              : '正在检查…'}
        </Text>
        {state && !state.supported && (
          <Text size="xs" c="dimmed">
            源码模式使用后端进程 PATH 中的 FFmpeg 与 ffprobe；安装或更换后请重启后端。
          </Text>
        )}
        {state?.supported && !state.managed_installed && (
          <Text size="xs" c="dimmed">
            应用版本约需下载 110 MB；系统版本已可用时无需安装。
          </Text>
        )}
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            disabled={busy}
            onClick={() => void run('check')}
          >
            检查环境
          </Button>
          {state?.supported && (
            <Button
              leftSection={<IconDownload size={16} />}
              disabled={busy || !writable}
              onClick={() => void run('install')}
            >
              {!state.managed_installed
                ? '安装应用版本'
                : state.update_available
                  ? '更新应用版本'
                  : '修复安装'}
            </Button>
          )}
        </Group>
        {state?.job.running && <Progress value={state.job.progress} aria-label="FFmpeg 安装进度" />}
        {state?.job.stage && (
          <Text size="xs" c="dimmed" role="status">
            {state.job.stage}
          </Text>
        )}
        {(error || state?.job.error) && (
          <Alert color="red" icon={<IconAlertCircle size={17} />}>
            {error || state?.job.error}
          </Alert>
        )}
        {state && (
          <details>
            <summary>环境详情</summary>
            <dl className="settings-runtime-meta">
              <div>
                <dt>位置</dt>
                <dd>{state.path || '未找到'}</dd>
              </div>
              <div>
                <dt>ffprobe</dt>
                <dd>{state.ffprobe_version || '不可用'}</dd>
              </div>
              <div>
                <dt>兼容版本</dt>
                <dd>{state.recipe || '由系统提供'}</dd>
              </div>
            </dl>
            {state.supported && (
              <Text size="xs" c="dimmed" mt="xs">
                应用版本来自{' '}
                <a
                  href="https://www.gyan.dev/ffmpeg/builds/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Gyan FFmpeg builds
                </a>
                ，按 GPLv3 提供。
              </Text>
            )}
          </details>
        )}
      </div>
    </SettingsCard>
  )
}

function AIRuntime() {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [state, setState] = useState<AIRuntimeStatus>()
  const [variant, setVariant] = useState<'cpu' | 'cu128'>('cu128')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const busy = pending || !!state?.job.running

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const value = await apiFetch<AIRuntimeStatus>('/ai-runtime')
        if (active) {
          setState(value)
          setVariant(value.variant)
          setError('')
        }
      } catch (cause) {
        if (active) setError(errorText(cause, '无法读取 AI 运行环境'))
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      if (!document.hidden && (state?.job.running || error)) void refresh()
    }, 2500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [state?.job.running, error])

  async function run(action: 'check' | 'install') {
    if (action === 'install' && !writable) return
    setPending(true)
    setError('')
    try {
      setState(
        await apiFetch<AIRuntimeStatus>(`/ai-runtime/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variant })
        })
      )
    } catch (cause) {
      setError(errorText(cause, '无法启动 AI 运行环境任务'))
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsCard
      title={t('pytorchRuntime')}
      description={
        state && !state.supported
          ? '源码模式由启动后端的 Python 环境管理 AI 依赖；具体模型是否可用请查看 AI 接入中的状态。'
          : '桌面应用为图文检索、图片重排和内容处理安装独立依赖；不会改动系统 Python。'
      }
      actions={
        state?.supported ? (
          <Badge color={state.check.ready ? 'teal' : 'gray'} variant="light">
            {state.job.running
              ? state.job.stage
              : state.check.ready
                ? '本地就绪'
                : state.installed
                  ? '需要检查'
                  : '未安装'}
          </Badge>
        ) : undefined
      }
    >
      <div className="settings-field-stack" style={{ paddingTop: 12 }}>
        {state?.supported ? (
          <>
            <Group gap="xs" align="end">
              <Select
                label="设备"
                value={variant}
                onChange={(value) => value && setVariant(value as 'cpu' | 'cu128')}
                data={[
                  { value: 'cu128', label: 'NVIDIA GPU · CUDA 12.8' },
                  { value: 'cpu', label: 'CPU' }
                ]}
                style={{ minWidth: 220 }}
                disabled={busy || !writable}
              />
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                disabled={busy || !state.installed}
                onClick={() => void run('check')}
              >
                检查环境
              </Button>
              <Button
                leftSection={<IconDownload size={16} />}
                disabled={busy || !writable}
                onClick={() => void run('install')}
              >
                {!state.installed
                  ? '安装必要依赖'
                  : state.update_available
                    ? '更新运行环境'
                    : '修复安装'}
              </Button>
            </Group>
            {state.job.running && (
              <Progress value={state.job.progress} aria-label="AI 运行环境安装进度" />
            )}
            {state.job.stage && (
              <Text size="xs" c="dimmed" role="status">
                {state.job.stage}
              </Text>
            )}
            {variant === 'cu128' && !state.installed && (
              <Text size="xs" c="dimmed">
                首次 GPU 安装需要数 GB 空间；模型文件另行下载。
              </Text>
            )}
            {state.check.device && (
              <Text size="xs" c="dimmed">
                当前推理设备：{state.check.device}
              </Text>
            )}
          </>
        ) : (
          <Text size="sm" c="dimmed">
            此处只管理桌面应用的独立运行环境，不检查当前 Python 的 PyTorch
            安装状态。源码模式请在启动后端的 Python 环境安装或更新依赖，重启后端后到 AI
            接入查看具体模型状态。
          </Text>
        )}
        {(error || state?.job.error) && (
          <Alert color="red" icon={<IconAlertCircle size={17} />}>
            {error || state?.job.error}
          </Alert>
        )}
        {state?.supported && (
          <details>
            <summary>环境详情</summary>
            <dl className="settings-runtime-meta">
              <div>
                <dt>位置</dt>
                <dd>{state.path || '未安装'}</dd>
              </div>
              <div>
                <dt>兼容版本</dt>
                <dd>{state.recipe}</dd>
              </div>
              {Object.entries(state.check.versions || {}).map(([name, version]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{version}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </SettingsCard>
  )
}

export default function RuntimeSettings() {
  return (
    <div className="settings-stack">
      <MediaRuntime />
      <AIRuntime />
    </div>
  )
}
