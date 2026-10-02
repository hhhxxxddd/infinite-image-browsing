import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Text,
  Tooltip,
  UnstyledButton
} from '@mantine/core'
import {
  IconArrowRight,
  IconEdit,
  IconFolderOpen,
  IconLayoutGrid,
  IconMusic,
  IconPhoto,
  IconRobot,
  IconTrash,
  IconVideo
} from '@tabler/icons-react'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import { studioLayerVisible } from '../../../src/features/image-editor/model/imageStudioModel'
import { renderStudioDocument } from '../../../src/features/image-editor/model/imageStudioRender'
import { createWorkspaceDraftRepository } from '../../../src/features/workspaces/model/workspaceDraftRepository'
import { collectWorkUsedAssets } from '../../../src/features/workspaces/model/workspaceMaterialsPool'
import { productionArtifacts } from '../../../src/features/workspaces/model/productionArtifacts'
import { readAICreationSession } from '../../../src/features/ai-workflows/model/aiCreationSession'
import {
  draftKindLabel,
  type ProductionDraft,
  type WorkspaceWork
} from '../../../src/features/workspaces/model/workspaceWorks'
import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import { readWorkspaceState } from '../../shared/workspaceState'
import { apiUrl } from '../../shared/apiClient'
import { draftCoverFallback, readAIDraftCover } from './draftCoverState'

interface Props {
  workspaceId: string
  work: WorkspaceWork
  draft: ProductionDraft
  assetInfo: Record<string, FileNodeInfo>
  available: WorkspaceAsset[]
  artifacts: WorkspaceArtifact[]
  readonly: boolean
  busy: boolean
  onOpen: (draft: ProductionDraft) => void
  onEdit: (draft: ProductionDraft) => void
  onRemove: (draft: ProductionDraft) => void
  onExport: (draft: ProductionDraft) => void
  onMaterials: (draft: ProductionDraft) => void
  onArtifacts: (draft: ProductionDraft) => void
  onPreview: (asset: WorkspaceAsset) => void
}

const icons = { image: IconPhoto, video: IconVideo, audio: IconMusic, ai: IconRobot }
function dateLabel(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function ProductionDraftCard(props: Props) {
  const { workspaceId, work, draft, assetInfo, available, artifacts, readonly, busy } = props
  const root = useRef<HTMLElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [ready, setReady] = useState(false)
  const [coverLoaded, setCoverLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [summary, setSummary] = useState('')
  const [mainPath, setMainPath] = useState('')
  const [updatedAt, setUpdatedAt] = useState(draft.updatedAt)
  const Icon = icons[draft.kind]
  const source = work.drafts.find((item) => item.id === draft.source?.documentId)
  const produced = useMemo(
    () => productionArtifacts(artifacts, workspaceId, draft.id, draft.kind),
    [artifacts, workspaceId, draft.id, draft.kind]
  )
  const used = useMemo(
    () =>
      collectWorkUsedAssets(
        workspaceId,
        { id: work.id, drafts: [draft] },
        readWorkspaceState(workspaceId),
        available
      ),
    [workspaceId, work.id, draft, available]
  )
  const generation =
    draft.kind === 'ai' &&
    readAICreationSession(
      readWorkspaceState(workspaceId),
      workspaceId,
      `${work.id}:${draft.id}`,
      draft.aiPurpose
    ).imageTask === 'generation'

  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '120px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !canvas.current) return
    let active = true
    setReady(false)
    setCoverLoaded(false)
    setFailed(false)
    setMainPath('')
    setSummary('')
    setUpdatedAt(draft.updatedAt)
    void (async () => {
      if (generation) {
        const artifact = produced.find((item) => item.source === 'ai_image_generation')
        setSummary(
          artifact ? `${artifact.width} × ${artifact.height} · 纯文字生成` : '纯文字生成 · 尚无产物'
        )
        if (!artifact) return
        const image = new Image()
        image.src = apiUrl(
          `/workspace_artifacts/${encodeURIComponent(artifact.id)}/thumbnail?size=400`
        )
        await image.decode()
        if (!active || !canvas.current) return
        canvas.current.width = image.naturalWidth
        canvas.current.height = image.naturalHeight
        canvas.current.getContext('2d')?.drawImage(image, 0, 0)
        setReady(true)
        return
      }
      const storage = readWorkspaceState(workspaceId)
      let doc
      let refCount = 0
      if (draft.kind === 'image')
        doc = createWorkspaceDraftRepository(workspaceId, storage).loadDocument(draft.id)
      else if (draft.kind === 'ai') {
        const cover = readAIDraftCover(storage, workspaceId, work.id, draft.id)
        setMainPath(cover.mainPath)
        doc = cover.document
        refCount = cover.referenceCount
      }
      if (!doc) {
        if (draft.kind === 'image') setFailed(true)
        return
      }
      setSummary(
        `${doc.width} × ${doc.height} · ${draft.kind === 'ai' ? `${refCount} 张参考图` : `${doc.layers.length} 个图层`}`
      )
      setUpdatedAt(doc.updatedAt > draft.updatedAt ? doc.updatedAt : draft.updatedAt)
      const target = document.createElement('canvas')
      const errors = await renderStudioDocument(target, doc, assetInfo, true, { kind: 'all' }, 400)
      if (!active || !canvas.current) return
      canvas.current.width = target.width
      canvas.current.height = target.height
      canvas.current.getContext('2d')?.drawImage(target, 0, 0)
      setReady(true)
      setFailed(
        errors.length >
          doc.layers.filter(
            (layer) => layer.kind === 'image' && !layer.path && studioLayerVisible(doc, layer)
          ).length
      )
    })()
      .catch(() => {
        if (active) setFailed(true)
      })
      .finally(() => {
        if (active) setCoverLoaded(true)
      })
    return () => {
      active = false
    }
  }, [visible, workspaceId, work.id, draft, generation, produced, assetInfo])

  const emptySummary = draftCoverFallback({
    kind: draft.kind,
    generation: !!generation,
    loaded: coverLoaded,
    mainPath
  })
  const sourceTitle = draft.source
    ? `${source?.name ?? '来源制作文件已删除'} · ${draft.source.label}`
    : assetInfo[mainPath]?.name || mainPath.split(/[\\/]/).pop() || ''
  return (
    <Card
      component="article"
      ref={root}
      className="wb-draft-card"
      data-kind={draft.kind}
      padding={0}
      radius={8}
      withBorder
    >
      <div className="wb-draft-header">
        <UnstyledButton
          className="wb-draft-title"
          aria-label={`打开制作文件：${draft.name}`}
          disabled={busy}
          onClick={() => props.onOpen(draft)}
        >
          <span className="wb-draft-file-icon">
            <Icon size={18} stroke={1.6} aria-hidden />
          </span>
          <span className="wb-draft-file-name">
            <Text fw={700} size="sm" lineClamp={2} title={draft.name}>
              {draft.name}
            </Text>
            <Text component="span" size="xs" c="var(--wb-accent-ink)">
              {draft.kind === 'ai'
                ? generation
                  ? 'AI 图片生成'
                  : 'AI 图片编辑'
                : draftKindLabel(draft.kind)}
            </Text>
          </span>
        </UnstyledButton>
        <Group wrap="nowrap" gap={2}>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={`修改制作信息：${draft.name}`}
            disabled={readonly || busy}
            onClick={() => props.onEdit(draft)}
          >
            <IconEdit size={15} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={`删除制作文件：${draft.name}`}
            disabled={readonly || busy}
            onClick={() => props.onRemove(draft)}
          >
            <IconTrash size={15} />
          </ActionIcon>
        </Group>
      </div>
      <div className="wb-draft-cover">
        <UnstyledButton
          className="wb-draft-entry"
          aria-label={`继续编辑：${draft.name}`}
          onClick={() => props.onOpen(draft)}
          disabled={busy}
        >
          <canvas ref={canvas} hidden={!ready} aria-label={`${draft.name}制作预览`} />
          {!ready && (
            <div className="wb-draft-placeholder">
              <Icon size={44} stroke={1.2} />
            </div>
          )}
          <span className="wb-draft-hover">
            继续编辑 <IconArrowRight size={15} />
          </span>
        </UnstyledButton>
        <div className="wb-draft-labels">
          {draft.kind === 'ai' && !generation && (draft.source || mainPath) && (
            <Tooltip label={sourceTitle}>
              <Badge
                component="button"
                type="button"
                variant="light"
                color="gray"
                size="sm"
                aria-label={`查看来源：${sourceTitle}`}
                disabled={!!draft.source && !source}
                onClick={() => {
                  if (source) props.onOpen(source)
                  else if (mainPath && !draft.source)
                    props.onPreview(
                      available.find((asset) => asset.path === mainPath) ?? {
                        path: mainPath,
                        name: assetInfo[mainPath]?.name ?? sourceTitle,
                        kind: 'image'
                      }
                    )
                }}
              >
                来源
              </Badge>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="wb-draft-copy">
        <Text size="xs" c="dimmed">
          {summary || emptySummary}
        </Text>
        {failed && (
          <Text size="xs" c="orange" mt={4}>
            部分图层无法预览，制作文件仍可继续编辑。
          </Text>
        )}
        <Group justify="space-between" mt="sm" gap={4} wrap="wrap">
          <Text size="xs" c="dimmed">
            {dateLabel(updatedAt)} 更新
          </Text>
          <Group gap={0}>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconFolderOpen size={12} />}
              aria-label={`查看使用素材：${draft.name}`}
              onClick={() => props.onMaterials(draft)}
            >
              使用素材 {used.length}
            </Button>
            <Button
              size="compact-xs"
              variant="light"
              color="product"
              leftSection={<IconLayoutGrid size={12} />}
              aria-label={`查看制作产物：${draft.name}`}
              onClick={() => props.onArtifacts(draft)}
            >
              产物 {produced.length}
            </Button>
          </Group>
        </Group>
        <div className="wb-draft-footer">
          <Button
            fullWidth
            variant="light"
            color={draft.kind === 'image' ? 'product' : undefined}
            size="xs"
            disabled={busy || (draft.kind === 'image' && readonly)}
            onClick={() => (draft.kind === 'image' ? props.onExport(draft) : props.onOpen(draft))}
          >
            {draft.kind === 'image' ? '导出为产物' : '继续编辑 →'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
