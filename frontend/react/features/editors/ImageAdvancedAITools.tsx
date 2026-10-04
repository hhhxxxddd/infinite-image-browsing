import { useEffect, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core'
import { IconChevronRight, IconEdit, IconRefresh } from '@tabler/icons-react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import { readWorkspaceState, subscribeWorkspaceState } from '../../shared/workspaceState'
import { createWorkspaceWorksRepository } from '../../../src/features/workspaces/model/workspaceWorks'
import {
  workAIArtifacts,
  type AIWorkDestination
} from '../../../src/features/workspaces/model/aiProductionBranch'
import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'
import './ImageAdvancedAITools.css'

export default function ImageAdvancedAITools({
  workspaceId,
  sourceWorkId,
  active,
  name,
  disabled,
  busy,
  error,
  onCreate,
  onOpen
}: {
  workspaceId: string
  sourceWorkId: string
  active: boolean
  name?: string
  disabled: boolean
  busy: boolean
  error: string
  onCreate: (destination: AIWorkDestination) => Promise<void>
  onOpen: (draftId: string) => Promise<void>
}) {
  const readWorks = () =>
    createWorkspaceWorksRepository(workspaceId, readWorkspaceState(workspaceId)).load().works
  const [works, setWorks] = useState(readWorks)
  const [targetId, setTargetId] = useState(sourceWorkId)
  const [newName, setNewName] = useState('')
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([])
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [preview, setPreview] = useState<WorkspaceArtifact | null>(null)
  const target = works.find((work) => work.id === targetId)
  const results = workAIArtifacts(artifacts, workspaceId, target)
  const drafts =
    target?.drafts
      .filter((draft) => draft.kind === 'ai')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) ?? []

  useEffect(() => {
    if (!active) return
    const update = () =>
      setWorks(
        createWorkspaceWorksRepository(workspaceId, readWorkspaceState(workspaceId)).load().works
      )
    update()
    return subscribeWorkspaceState(workspaceId, update)
  }, [workspaceId, active])

  useEffect(() => {
    if (!active || !targetId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      setLoading(true)
      try {
        const items = await apiFetch<WorkspaceArtifact[]>(
          `/workspace_artifacts?workspace_id=${encodeURIComponent(workspaceId)}`,
          { signal: controller.signal }
        )
        if (controller.signal.aborted) return
        setArtifacts(items)
        setLoadError('')
      } catch (cause) {
        if (!controller.signal.aborted)
          setLoadError(cause instanceof Error ? cause.message : '加载产物失败')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          timer = setTimeout(() => void load(), 5000)
        }
      }
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [active, workspaceId, targetId, refresh])

  return (
    <Stack gap="sm" className="react-image-advanced-tools">
      <Text size="xs" c="dimmed" lineClamp={1} title={name}>
        {name ? `图片 · ${name}` : '请选择一个图片图层'}
      </Text>
      <Select
        label="目标作品"
        size="xs"
        value={targetId}
        searchable
        allowDeselect={false}
        data={[
          { value: '', label: '新建作品' },
          ...works.map((work) => ({
            value: work.id,
            label: `${work.name}${work.id === sourceWorkId ? '（当前作品）' : ''}`
          }))
        ]}
        onChange={(value) => setTargetId(value ?? '')}
        disabled={busy}
        comboboxProps={{
          withinPortal: true,
          portalProps: { target: '.react-editor-shell' },
          zIndex: 90
        }}
      />
      {!targetId && (
        <TextInput
          label="作品名称"
          size="xs"
          placeholder="输入新作品名称"
          value={newName}
          maxLength={80}
          onChange={(event) => setNewName(event.currentTarget.value)}
          disabled={busy}
        />
      )}
      <Button
        size="xs"
        loading={busy}
        disabled={disabled || (!targetId ? !newName.trim() : !target)}
        onClick={() =>
          void onCreate(
            targetId
              ? { kind: 'existing', workId: targetId }
              : { kind: 'new', workId: crypto.randomUUID(), name: newName.trim() }
          )
        }
      >
        {targetId ? '加入并打开 AI 编辑' : '创建并打开 AI 编辑'}
      </Button>
      {error && (
        <Alert color="red" p="xs">
          {error}
        </Alert>
      )}
      {target && (
        <>
          <Divider />
          <Group justify="space-between">
            <Text size="xs" fw={700}>
              作品 AI 产物
            </Text>
            <Tooltip label="刷新产物">
              <ActionIcon
                aria-label="刷新产物"
                size="sm"
                variant="subtle"
                loading={loading}
                onClick={() => setRefresh((value) => value + 1)}
              >
                <IconRefresh size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
          {loadError && (
            <Text c="red" size="xs">
              {loadError}
            </Text>
          )}
          {!results.length && !loadError && (
            <Text size="xs" c="dimmed">
              {loading ? '正在加载…' : '暂无 AI 产物'}
            </Text>
          )}
          {!!results.length && (
            <div className="react-image-advanced-results">
              {results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.name}
                  aria-label={`查看产物：${item.name}`}
                  onClick={() => setPreview(item)}
                >
                  <img
                    alt={item.name}
                    loading="lazy"
                    src={apiUrl(
                      `/workspace_artifacts/${encodeURIComponent(item.id)}/thumbnail?size=320`
                    )}
                  />
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          )}
          {!!drafts.length && (
            <>
              <Divider />
              <Text size="xs" fw={700}>
                继续编辑
              </Text>
              <div className="react-image-advanced-drafts">
                {drafts.map((draft) => (
                  <Button
                    size="xs"
                    variant="subtle"
                    fullWidth
                    leftSection={<IconEdit size={14} />}
                    rightSection={<IconChevronRight size={14} />}
                    key={draft.id}
                    title={draft.name}
                    disabled={busy}
                    onClick={() => void onOpen(draft.id)}
                  >
                    {draft.name}
                  </Button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <Modal
        opened={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.name}
        size="lg"
        centered
        zIndex={220}
      >
        {preview && (
          <Stack gap="sm">
            <img
              className="react-image-advanced-preview"
              alt={preview.name}
              src={apiUrl(`/workspace_artifacts/${encodeURIComponent(preview.id)}/file`)}
            />
            <Group justify="space-between">
              <Text c="dimmed" size="xs">
                {preview.width} × {preview.height}
              </Text>
              <Button
                size="xs"
                disabled={busy || !preview.document_id}
                onClick={() => {
                  if (preview.document_id) void onOpen(preview.document_id)
                }}
              >
                打开 AI 编辑
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
