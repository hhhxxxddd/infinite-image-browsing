import { Alert, Badge, Button, Group, Progress, Select, Text } from '@mantine/core'
import { IconAlertCircle, IconDownload, IconRefresh } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { errorText, SettingsCard } from './components'
import { useSettingsWritable } from './SettingsAccess'

type State = {
  supported: boolean
  installed: boolean
  path: string
  recipe: string
  update_available: boolean
  variant: string
  version?: string
  job: { running: boolean; stage: string; progress: number; error: string }
}

export default function GGUFRuntimeSettings() {
  const writable = useSettingsWritable()
  const [state, setState] = useState<State>()
  const [variant, setVariant] = useState('cuda')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void apiFetch<State>('/gguf-runtime')
      .then((next) => {
        if (!active) return
        setState(next)
        if (next.variant) setVariant(next.variant)
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取 GGUF 引擎状态'))
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!state?.job.running) return
    let active = true
    let polling = false
    const timer = window.setInterval(() => {
      if (document.hidden || polling) return
      polling = true
      void apiFetch<State>('/gguf-runtime')
        .then((next) => {
          if (active) setState(next)
        })
        .catch((cause: unknown) => {
          if (active) setError(errorText(cause, '读取 GGUF 安装进度失败'))
        })
        .finally(() => {
          polling = false
        })
    }, 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [state?.job.running])

  async function run(action: 'install' | 'check') {
    if (!writable) return
    setBusy(true)
    setError('')
    try {
      const next = await apiFetch<State>(`/gguf-runtime/${action}`, {
        method: 'POST',
        body: action === 'install' ? JSON.stringify({ variant }) : undefined
      })
      setState(next)
    } catch (cause) {
      setError(errorText(cause, 'GGUF 引擎操作失败'))
    } finally {
      setBusy(false)
    }
  }

  const pending = busy || state?.job.running
  return (
    <SettingsCard
      title="GGUF 引擎"
      description="图文检索、结果重排与图片理解的原生运行环境；应用自动启动、切换模型，空闲两分钟后释放资源。"
    >
      <Group justify="space-between" py="sm">
        <Text size="sm">llama.cpp · 本机推理</Text>
        <Badge variant="light" color={state?.installed ? 'green' : 'gray'}>
          {state?.installed ? '已安装' : '未安装'}
        </Badge>
      </Group>
      {state?.supported && (
        <Select
          label="推理设备"
          value={variant}
          onChange={(value) => value && setVariant(value)}
          data={[
            { value: 'cuda', label: 'NVIDIA GPU · CUDA 12.4' },
            { value: 'cpu', label: 'CPU' }
          ]}
          disabled={!!pending || !writable}
          mb="sm"
        />
      )}
      <Group gap="xs">
        <Button
          variant="default"
          leftSection={<IconRefresh size={16} />}
          disabled={!writable || !!pending || !state?.installed}
          onClick={() => void run('check')}
        >
          检查引擎
        </Button>
        {state?.supported && (
          <Button
            leftSection={<IconDownload size={16} />}
            disabled={!writable || !!pending}
            onClick={() => void run('install')}
          >
            {!state.installed ? '安装 GGUF 引擎' : state.update_available ? '更新引擎' : '修复安装'}
          </Button>
        )}
      </Group>
      {state?.job.running && (
        <Progress mt="sm" value={state.job.progress} aria-label="GGUF 引擎安装进度" />
      )}
      {state?.job.stage && (
        <Text size="xs" c="dimmed" mt="sm" role="status">
          {state.job.stage}
        </Text>
      )}
      {state?.version && (
        <Text size="xs" c="dimmed" mt="sm" role="status">
          引擎检查通过
        </Text>
      )}
      {(error || state?.job.error) && (
        <Alert mt="sm" color="red" icon={<IconAlertCircle size={17} />}>
          {error || state?.job.error}
        </Alert>
      )}
      <Text size="xs" c="dimmed" mt="sm">
        模型文件在 AI 接入中管理。主模型和配套 mmproj 均需下载，无需额外的 Python 或 PyTorch。
      </Text>
      {state?.path && (
        <Text size="xs" c="dimmed" mt="sm" style={{ overflowWrap: 'anywhere' }}>
          引擎位置：{state.path}
        </Text>
      )}
    </SettingsCard>
  )
}
