import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Group, Loader, Modal, Select, Stack, Text } from '@mantine/core'
import { IconFolder, IconRefresh } from '@tabler/icons-react'
import { apiFetch } from '../../shared/apiClient'
import { getFolderPickerPath } from '../media/mediaApi'
import { readWorkspaceState } from '../../shared/workspaceState'
import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { SourceRelinkSource } from './sourceRelink'
import { createSourceCommitGate } from './sourceCommitGate'
import { inspectProjectSources } from './projectSourceInspection'
import {
  prepareProjectSourceRelinks,
  projectSourceHealth,
  projectSourceMatches,
  projectSourceSignature,
  proposeProjectSourceChoices,
  sourceFilename,
  type ProjectSourceCandidates,
  type ProjectSourceInspection,
  type ProjectSourceKind,
  type ProjectSourceRelinkSelection
} from './projectSources'
import './ProjectSourcesDialog.css'

export interface ProjectSourcesDialogProps {
  opened: boolean
  onClose: () => void
  workspaceId: string
  draftId: string
  kind: ProjectSourceKind
  sources: SourceRelinkSource[]
  lockedPaths: string[]
  readonly?: boolean
  onChooseSource: (path: string) => void
  onConfirm: (selections: ProjectSourceRelinkSelection[]) => void | Promise<void>
}
const stateLabels = {
  available: '可用',
  missing: '缺失',
  unavailable: '不可访问',
  invalid: '不满足片段',
  error: '检查失败',
  unchecked: '待检查'
}
const emptyCandidates: ProjectSourceCandidates = {
  candidates: [],
  complete: true,
  case_sensitive: true,
  scanned_entries: 0,
  skipped_directories: 0
}

export default function ProjectSourcesDialog(props: ProjectSourcesDialogProps) {
  const [gate] = useState(createSourceCommitGate)
  const [committing, setCommitting] = useState(false)
  const close = () => {
    gate.requestClose(props.onClose)
  }
  return (
    <Modal
      opened={props.opened}
      onClose={close}
      title="修复素材"
      size="md"
      centered
      closeButtonProps={{ disabled: committing }}
      closeOnEscape={!committing}
      closeOnClickOutside={!committing}
    >
      {props.opened && (
        <ProjectSourcesContent
          key={`${props.workspaceId}:${props.draftId}:${props.kind}`}
          {...props}
          onClose={close}
          committing={committing}
          onConfirm={(selections) => gate.run(() => props.onConfirm(selections), setCommitting)}
        />
      )}
    </Modal>
  )
}

function ProjectSourcesContent({
  workspaceId,
  draftId,
  kind,
  sources,
  lockedPaths,
  readonly = false,
  onClose,
  onConfirm,
  onChooseSource,
  committing
}: ProjectSourcesDialogProps & { committing: boolean }) {
  const [originals, setOriginals] = useState<ProjectSourceInspection[]>([])
  const [candidateChecks, setCandidateChecks] = useState<ProjectSourceInspection[]>([])
  const [candidates, setCandidates] = useState(emptyCandidates)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [directory, setDirectory] = useState('')
  const [searched, setSearched] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [checkingChoices, setCheckingChoices] = useState(false)
  const sourceKey = sources.map(projectSourceSignature).sort().join('\n')
  const live = useRef(true)
  const active = useRef<AbortController | null>(null)
  const policy = useRef({ sourceKey, readonly, sources, lockedPaths })
  policy.current = { sourceKey, readonly, sources, lockedPaths }
  const context = { workspace_id: workspaceId, document_id: draftId, kind }
  const health = sources.map((source) =>
    projectSourceHealth(
      source,
      originals.find((item) => item.path === source.path && item.kind === source.kind)
    )
  )
  const problems = health.filter((item) => item.state !== 'available')
  const candidateSourceCounts = new Map<string, number>()
  for (const item of problems)
    for (const candidate of projectSourceMatches(item.source, candidates)) {
      candidateSourceCounts.set(
        candidate.path,
        (candidateSourceCounts.get(candidate.path) ?? 0) + 1
      )
    }
  const selectedPaths = Object.values(choices).filter(Boolean)
  const selectedCandidates = candidates.candidates.filter((asset) =>
    selectedPaths.includes(asset.path)
  )
  const selectedKey = JSON.stringify(selectedCandidates.map((asset) => [asset.path, asset.kind]))

  function inspect(
    assets: Pick<WorkspaceAsset, 'path' | 'kind'>[],
    signal: AbortSignal,
    progress?: (count: number) => void
  ) {
    return inspectProjectSources(context, assets, signal, progress)
  }
  function assertLive(expected: string) {
    if (!live.current || expected !== policy.current.sourceKey)
      throw new Error('制作文件的素材引用已变化，请重新检查')
    if (policy.current.readonly) throw new Error('当前制作文件为只读')
    assertProductionDraftExists(readWorkspaceState(workspaceId), workspaceId, draftId)
  }
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      active.current?.abort()
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    active.current?.abort()
    active.current = controller
    setOriginals([])
    setSearched(false)
    setCandidates(emptyCandidates)
    setChoices({})
    setCandidateChecks([])
    setError('')
    setBusy(sources.length ? `检查素材 0 / ${sources.length}` : '')
    void inspect(sources, controller.signal, (count) => {
      if (!controller.signal.aborted) setBusy(`检查素材 ${count} / ${sources.length}`)
    })
      .then((values) => {
        if (!controller.signal.aborted) setOriginals(values)
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '素材检查失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy('')
      })
    return () => controller.abort()
  }, [sourceKey, refresh])

  useEffect(() => {
    const controller = new AbortController()
    setCheckingChoices(selectedCandidates.length > 0)
    setCandidateChecks([])
    void inspect(selectedCandidates, controller.signal)
      .then((values) => {
        if (!controller.signal.aborted) setCandidateChecks(values)
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '候选检查失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setCheckingChoices(false)
      })
    return () => controller.abort()
  }, [selectedKey, refresh])

  async function findDirectory(searchDirectory = directory) {
    if (busy || committing || readonly || !searchDirectory.trim() || !problems.length) return
    const controller = new AbortController()
    active.current?.abort()
    active.current = controller
    const expected = sourceKey
    setBusy('查找同名素材…')
    setSearched(false)
    setError('')
    setChoices({})
    setCandidates(emptyCandidates)
    try {
      const response = await apiFetch<ProjectSourceCandidates>('/source_relink/candidates', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          ...context,
          directory: searchDirectory.trim(),
          recursive: true,
          names: [...new Set(problems.map((item) => sourceFilename(item.source)))]
        })
      })
      if (controller.signal.aborted || !live.current || policy.current.sourceKey !== expected)
        return
      setCandidates(response)
      setSearched(true)
      setChoices(
        Object.fromEntries(
          Object.entries(
            proposeProjectSourceChoices(
              problems.map((item) => item.source),
              response
            )
          ).filter(([path]) => !lockedPaths.includes(path))
        )
      )
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '查找失败')
    } finally {
      if (!controller.signal.aborted) setBusy('')
    }
  }
  async function chooseDirectory() {
    setError('')
    try {
      const path = await getFolderPickerPath()
      if (live.current && path) {
        setDirectory(path)
        await findDirectory(path)
      }
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '无法选择目录')
    }
  }
  async function confirm() {
    if (readonly || busy || checkingChoices || committing || !selectedCandidates.length) return
    const controller = new AbortController()
    active.current?.abort()
    active.current = controller
    const expected = sourceKey
    setBusy('复核替换素材…')
    setError('')
    try {
      const fresh = await inspect(selectedCandidates, controller.signal)
      if (controller.signal.aborted) return
      assertLive(expected)
      const selections = prepareProjectSourceRelinks(
        policy.current.sources,
        choices,
        candidates.candidates,
        fresh,
        policy.current
      )
      setCandidateChecks(fresh)
      await onConfirm(selections)
      if (live.current) onClose()
    } catch (cause) {
      if (!controller.signal.aborted && live.current)
        setError(cause instanceof Error ? cause.message : '重新定位失败')
    } finally {
      if (!controller.signal.aborted && live.current) setBusy('')
    }
  }
  let selectionError = ''
  if (selectedCandidates.length && !checkingChoices) {
    try {
      prepareProjectSourceRelinks(sources, choices, candidates.candidates, candidateChecks, {
        readonly,
        lockedPaths
      })
    } catch (cause) {
      selectionError = cause instanceof Error ? cause.message : '候选不可用'
    }
  }
  return (
    <Stack gap="sm" className="project-sources-dialog">
      <Group justify="space-between">
        <Text size="sm">
          {busy
            ? '正在检查素材…'
            : problems.length
              ? `需要修复 ${problems.length} 项`
              : '素材状态正常'}
        </Text>
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconRefresh size={14} />}
          disabled={!!busy || committing}
          onClick={() => setRefresh((value) => value + 1)}
        >
          重新检查
        </Button>
      </Group>
      {!!problems.length && !busy && (
        <>
          <Text size="xs" c="dimmed">
            素材移动后，选择所在文件夹即可查找；也可以逐项选择替代素材。
          </Text>
          <Group gap="xs">
            <Button
              size="xs"
              variant="light"
              leftSection={<IconFolder size={15} />}
              onClick={() => void chooseDirectory()}
              disabled={readonly || committing}
            >
              选择素材所在文件夹
            </Button>
            {directory && (
              <Button
                size="xs"
                variant="subtle"
                disabled={readonly || committing}
                onClick={() => void findDirectory()}
              >
                重新查找
              </Button>
            )}
          </Group>
          {directory && (
            <Text size="xs" c="dimmed" truncate title={directory}>
              {directory}
            </Text>
          )}
        </>
      )}
      {!!busy && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="xs">{busy}</Text>
        </Group>
      )}
      {!candidates.complete && (
        <Alert color="yellow" p="xs">
          部分目录未检查完，候选不会自动选中。请缩小目录范围后重试，或逐项确认。
        </Alert>
      )}
      <div className="project-source-list">
        {!problems.length && !busy && (
          <Text size="sm" c="dimmed" p="sm">
            {sources.length ? '所有素材均可用，无需修复' : '当前制作文件没有引用素材'}
          </Text>
        )}
        {!busy &&
          problems.map((item) => {
            const matches = projectSourceMatches(item.source, candidates)
            const chosen = candidates.candidates.find(
              (asset) => asset.path === choices[item.source.path]
            )
            const shared = matches.some(
              (candidate) => (candidateSourceCounts.get(candidate.path) ?? 0) > 1
            )
            const checked =
              chosen &&
              candidateChecks.find(
                (value) => value.path === chosen.path && value.kind === chosen.kind
              )
            let candidateError = ''
            if (chosen && !checkingChoices) {
              try {
                prepareProjectSourceRelinks(
                  [item.source],
                  { [item.source.path]: chosen.path },
                  [chosen],
                  checked ? [checked] : [],
                  { lockedPaths }
                )
              } catch (cause) {
                candidateError = cause instanceof Error ? cause.message : '候选不可用'
              }
            }
            return (
              <div key={item.source.path} className="project-source-row">
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={500} truncate>
                    {item.source.name}
                  </Text>
                  <Badge
                    color={
                      item.state === 'available'
                        ? 'teal'
                        : item.state === 'missing'
                          ? 'red'
                          : 'yellow'
                    }
                    size="xs"
                  >
                    {stateLabels[item.state]}
                  </Badge>
                </Group>
                <Text
                  size="xs"
                  c="dimmed"
                  className="project-source-path"
                  truncate
                  title={item.source.path}
                >
                  {item.source.path}
                </Text>
                <Text size="xs" c="dimmed">
                  {item.source.clips.length} 处引用
                  {lockedPaths.includes(item.source.path) ? ' · 轨道已锁定' : ''}
                  {item.error ? ` · ${item.error}` : ''}
                </Text>
                {!!matches.length && (
                  <Select
                    size="xs"
                    label={matches.length > 1 ? `${matches.length} 个同名候选，请选择` : '拟替换为'}
                    placeholder="保留原引用"
                    clearable
                    searchable
                    value={choices[item.source.path] || null}
                    data={matches.map((asset) => ({ value: asset.path, label: asset.path }))}
                    disabled={
                      readonly || !!busy || committing || lockedPaths.includes(item.source.path)
                    }
                    onChange={(value) =>
                      setChoices((current) => ({ ...current, [item.source.path]: value ?? '' }))
                    }
                  />
                )}
                {searched && item.state !== 'available' && !matches.length && (
                  <Text size="xs" c="dimmed">
                    未找到同名素材，请选择其他文件夹或替代素材。
                  </Text>
                )}
                <Button
                  size="compact-xs"
                  variant="subtle"
                  style={{ justifySelf: 'start' }}
                  disabled={readonly || committing || lockedPaths.includes(item.source.path)}
                  onClick={() => onChooseSource(item.source.path)}
                >
                  选择替代素材
                </Button>
                {shared && (
                  <Text size="xs" c="yellow">
                    候选也匹配其他源文件，请核对完整路径后选择。
                  </Text>
                )}
                {chosen && (
                  <Text size="xs" c={candidateError ? 'red' : 'dimmed'}>
                    {checkingChoices
                      ? '验证候选类型与时长…'
                      : candidateError || '类型和源区间符合，可保留全部引用'}
                  </Text>
                )}
              </div>
            )
          })}
      </div>
      {(error || selectionError) && (
        <Alert color="red" p="xs">
          {error || selectionError}
        </Alert>
      )}
      {readonly && (
        <Text size="xs" c="dimmed">
          只读模式可检查素材，无法修改引用。
        </Text>
      )}
      <Group justify="flex-end">
        <Button variant="default" disabled={committing} onClick={onClose}>
          关闭
        </Button>
        {!!problems.length && (
          <Button
            loading={committing}
            disabled={
              readonly ||
              !!busy ||
              checkingChoices ||
              !selectedCandidates.length ||
              !!selectionError
            }
            onClick={() => void confirm()}
          >
            修复 {Object.values(choices).filter(Boolean).length} 项
          </Button>
        )}
      </Group>
    </Stack>
  )
}
