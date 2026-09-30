import { Alert, Badge, Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core'
import { IconAlertCircle, IconDownload, IconRefresh } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { useLanguage } from '../../design/i18n'
import { errorText, SettingsCard } from './components'
import { useSettingsWritable } from './SettingsAccess'

type Kind = 'embedding' | 'reranker' | 'instruct'
type Size = '2B' | '8B'
type Quantization = 'none' | 'int8' | 'nf4'
type ModelOption = { size: Size; model: string; installed: boolean; active: boolean; path: string }
type Manager = {
  models: Record<Kind, ModelOption[]>
  job: { running: boolean; kind: Kind | ''; size: Size | ''; stage: string; error: string }
  managed_dir: string
}
type Status = {
  state: 'ready' | 'missing_model' | 'missing_dependency'
  detail: string
  model: string
  model_path: string
  quantization?: Quantization
  config_source: 'settings' | 'environment'
  image_count?: number
  indexed_count?: number
  running?: boolean
  processed?: number
  total?: number
  failed?: number
  error?: string
}

const kinds: { kind: Kind; title: string; description: string }[] = [
  {
    kind: 'embedding',
    title: '图文检索',
    description: '以文字找画面与以图搜图；切换模型后需要重建图片索引。'
  },
  { kind: 'reranker', title: '结果重排', description: '对文字搜索的候选图片再次评分。' },
  { kind: 'instruct', title: '图片理解', description: '生成客观描述、提示词和标签建议。' }
]

function stateLabel(status?: Status) {
  if (!status) return '读取中'
  return status.state === 'ready'
    ? '已就绪'
    : status.state === 'missing_dependency'
      ? '缺少运行依赖'
      : '缺少模型'
}

export default function QwenSettings({ onOpenRuntime }: { onOpenRuntime?: () => void }) {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [manager, setManager] = useState<Manager>()
  const [statuses, setStatuses] = useState<Partial<Record<Kind, Status>>>({})
  const [paths, setPaths] = useState<Record<Kind, string>>({
    embedding: '',
    reranker: '',
    instruct: ''
  })
  const [sizes, setSizes] = useState<Record<Kind, Size>>({
    embedding: '2B',
    reranker: '2B',
    instruct: '2B'
  })
  const [quantization, setQuantization] = useState<Quantization>('none')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmIndex, setConfirmIndex] = useState(false)
  const sizesInitialized = useRef(false)
  const pathBaseline = useRef<Record<Kind, string>>({ embedding: '', reranker: '', instruct: '' })
  const quantBaseline = useRef<Quantization>('none')
  const polling = useRef(false)

  const refresh = useCallback(async (forceDraft?: Kind | 'quantization') => {
    const [nextManager, embedding, reranker, instruct] = await Promise.all([
      apiFetch<Manager>('/qwen-models'),
      apiFetch<Status>('/qwen3-vl/embedding/status'),
      apiFetch<Status>('/qwen3-vl/reranker/status'),
      apiFetch<Status>('/qwen3-vl/instruct/status')
    ])
    setManager(nextManager)
    setStatuses({ embedding, reranker, instruct })
    const nextPaths = {
      embedding: embedding.model_path,
      reranker: reranker.model_path,
      instruct: instruct.model_path
    }
    setPaths((current) => ({
      embedding:
        forceDraft === 'embedding' || current.embedding === pathBaseline.current.embedding
          ? nextPaths.embedding
          : current.embedding,
      reranker:
        forceDraft === 'reranker' || current.reranker === pathBaseline.current.reranker
          ? nextPaths.reranker
          : current.reranker,
      instruct:
        forceDraft === 'instruct' || current.instruct === pathBaseline.current.instruct
          ? nextPaths.instruct
          : current.instruct
    }))
    pathBaseline.current = nextPaths
    const nextQuant = instruct.quantization || 'none'
    setQuantization((current) =>
      forceDraft === 'quantization' || current === quantBaseline.current ? nextQuant : current
    )
    quantBaseline.current = nextQuant
    if (!sizesInitialized.current) {
      sizesInitialized.current = true
      setSizes((current) => {
        const next = { ...current }
        for (const kind of ['embedding', 'reranker', 'instruct'] as const) {
          const active = nextManager.models[kind]?.find((model) => model.active)
          if (active) next[kind] = active.size
        }
        return next
      })
    }
  }, [])

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(errorText(cause, '无法读取 Qwen 模型状态')))
  }, [refresh])

  useEffect(() => {
    if (!manager?.job.running && !Object.values(statuses).some((status) => status?.running)) return
    const timer = window.setInterval(() => {
      if (document.hidden || polling.current) return
      polling.current = true
      void (async () => {
        try {
          if (manager?.job.running) {
            const next = await apiFetch<Manager>('/qwen-models')
            setManager(next)
            if (!next.job.running) await refresh()
          } else if (statuses.embedding?.running) {
            const next = await apiFetch<Status>('/qwen3-vl/embedding/status')
            setStatuses((current) => ({ ...current, embedding: next }))
            if (!next.running) await refresh()
          }
        } catch (cause) {
          setError(errorText(cause, '刷新 Qwen 任务状态失败'))
        } finally {
          polling.current = false
        }
      })()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [manager?.job.running, statuses.embedding?.running, refresh])

  async function act(
    key: string,
    action: () => Promise<unknown>,
    success: string,
    forceDraft?: Kind | 'quantization'
  ) {
    if (!writable) return false
    setBusy(key)
    setError('')
    setNotice('')
    try {
      await action()
      await refresh(forceDraft)
      setNotice(success)
      return true
    } catch (cause) {
      setError(errorText(cause, '操作失败'))
      return false
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="settings-stack">
      {error && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={16} />}
          withCloseButton
          onClose={() => setError('')}
        >
          {error}
        </Alert>
      )}
      {notice && (
        <Alert color="teal" withCloseButton onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      <SettingsCard
        title={t('qwenModels')}
        description="模型放在本机；管理下载、版本选择、路径与图片索引。"
        actions={
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconRefresh size={15} />}
            onClick={() => void refresh()}
            disabled={!!busy}
          >
            刷新
          </Button>
        }
      >
        <Text size="xs" c="dimmed" py="sm">
          托管目录：{manager?.managed_dir || '读取中…'}
        </Text>
        <Text size="xs" c="dimmed" pb="sm">
          模型状态显示文件与依赖是否可用；首次实际检索或生成时会加载模型，可能需要等待。关闭此页面不会中止后台下载或索引任务。
        </Text>
        {manager?.job.running && (
          <Alert color="blue" my="sm">
            正在处理 {manager.job.kind} {manager.job.size}：{manager.job.stage || '准备中'}
          </Alert>
        )}
        {manager?.job.error && (
          <Alert color="red" my="sm">
            {manager.job.error}
          </Alert>
        )}
        {kinds.map(({ kind, title, description }) => {
          const status = statuses[kind]
          const options = manager?.models[kind] || []
          const picked = options.find((option) => option.size === sizes[kind])
          return (
            <section className="settings-qwen-card" key={kind}>
              <Group justify="space-between" align="start" mb="sm">
                <div>
                  <strong>{title}</strong>
                  <Text size="xs" c="dimmed">
                    {description}
                  </Text>
                </div>
                <Badge variant="light" color={status?.state === 'ready' ? 'teal' : 'orange'}>
                  {stateLabel(status)}
                </Badge>
              </Group>
              {status?.detail && (
                <Text size="xs" c="dimmed" mb="sm">
                  {status.detail}
                </Text>
              )}
              {status?.state === 'missing_dependency' && onOpenRuntime && (
                <Button size="xs" variant="subtle" mb="sm" onClick={onOpenRuntime}>
                  前往运行环境安装依赖
                </Button>
              )}
              <div className="settings-qwen-actions">
                <Select
                  label="模型规格"
                  value={sizes[kind]}
                  onChange={(value) =>
                    value && setSizes((current) => ({ ...current, [kind]: value as Size }))
                  }
                  data={[
                    { value: '2B', label: '2B · 约 4–5 GB' },
                    { value: '8B', label: '8B · 约 16–18 GB' }
                  ]}
                  disabled={!writable || !!busy || manager?.job.running}
                />
                {picked?.installed ? (
                  <Button
                    variant="light"
                    disabled={!writable || picked.active || !!busy || manager?.job.running}
                    loading={busy === `${kind}-select`}
                    onClick={() =>
                      void act(
                        `${kind}-select`,
                        () =>
                          apiFetch('/qwen-models/select', {
                            method: 'POST',
                            body: JSON.stringify({ kind, size: sizes[kind] })
                          }),
                        '已切换模型；图文检索模型切换后请重建索引'
                      )
                    }
                  >
                    {picked.active ? '正在使用' : '切换模型'}
                  </Button>
                ) : (
                  <Button
                    variant="light"
                    leftSection={<IconDownload size={15} />}
                    disabled={!writable || !!busy || manager?.job.running}
                    loading={busy === `${kind}-install`}
                    onClick={() =>
                      void act(
                        `${kind}-install`,
                        () =>
                          apiFetch('/qwen-models/install', {
                            method: 'POST',
                            body: JSON.stringify({ kind, size: sizes[kind] })
                          }),
                        '模型下载已开始'
                      )
                    }
                  >
                    下载安装
                  </Button>
                )}
              </div>
              <Group mt="sm" align="end" className="settings-qwen-path">
                <TextInput
                  label="自定义模型路径"
                  value={paths[kind]}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setPaths((current) => ({ ...current, [kind]: value }))
                  }}
                  placeholder="留空时使用托管模型或环境变量"
                  disabled={!writable || !!busy}
                />
                <Button
                  variant="default"
                  disabled={!writable || !!busy || paths[kind] === (status?.model_path || '')}
                  loading={busy === `${kind}-path`}
                  onClick={() =>
                    void act(
                      `${kind}-path`,
                      () =>
                        apiFetch(`/qwen3-vl/${kind}/config`, {
                          method: 'PUT',
                          body: JSON.stringify({ model_path: paths[kind].trim() })
                        }),
                      '模型路径已保存',
                      kind
                    )
                  }
                >
                  保存路径
                </Button>
                {status?.config_source === 'settings' && (
                  <Button
                    variant="subtle"
                    disabled={!writable || !!busy || manager?.job.running}
                    loading={busy === `${kind}-reset-path`}
                    onClick={() =>
                      void act(
                        `${kind}-reset-path`,
                        () =>
                          apiFetch(`/qwen3-vl/${kind}/config`, {
                            method: 'PUT',
                            body: JSON.stringify({ model_path: '' })
                          }),
                        '已恢复默认模型路径',
                        kind
                      )
                    }
                  >
                    恢复默认
                  </Button>
                )}
              </Group>
              {kind === 'embedding' && status && (
                <Group mt="sm" justify="space-between">
                  <Text size="xs" c="dimmed">
                    已索引 {status.indexed_count ?? 0} / {status.image_count ?? 0} 张图片
                    {status.running ? ` · ${status.processed ?? 0} / ${status.total ?? 0}` : ''}
                  </Text>
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={!writable || !!busy || !!status.running || status.state !== 'ready'}
                    onClick={() => setConfirmIndex(true)}
                  >
                    重建图片向量索引
                  </Button>
                </Group>
              )}
              {kind === 'instruct' && (
                <Group mt="sm" align="end">
                  <Select
                    label="量化"
                    value={quantization}
                    data={[
                      { value: 'none', label: '不量化' },
                      { value: 'int8', label: 'INT8' },
                      { value: 'nf4', label: 'NF4' }
                    ]}
                    onChange={(value) => value && setQuantization(value as Quantization)}
                    disabled={!writable || !!busy}
                  />
                  <Button
                    variant="default"
                    disabled={
                      !writable || !!busy || quantization === (status?.quantization || 'none')
                    }
                    loading={busy === 'quantization'}
                    onClick={() =>
                      void act(
                        'quantization',
                        () =>
                          apiFetch('/qwen3-vl/instruct/quantization', {
                            method: 'PUT',
                            body: JSON.stringify({ mode: quantization })
                          }),
                        '量化设置已保存',
                        'quantization'
                      )
                    }
                  >
                    保存量化
                  </Button>
                </Group>
              )}
            </section>
          )
        })}
      </SettingsCard>
      <Modal
        opened={confirmIndex}
        onClose={() => setConfirmIndex(false)}
        centered
        title="重建图片向量索引"
      >
        <Stack gap="md">
          <Text size="sm">
            切换图文检索模型后需要重新提取所有图片向量。此任务会在后台继续运行。
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmIndex(false)}>
              取消
            </Button>
            <Button
              loading={busy === 'index'}
              disabled={!writable}
              onClick={() =>
                void act(
                  'index',
                  () => apiFetch('/qwen3-vl/embedding/index', { method: 'POST' }),
                  '向量索引任务已开始'
                ).then((ok) => ok && setConfirmIndex(false))
              }
            >
              开始重建
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  )
}
