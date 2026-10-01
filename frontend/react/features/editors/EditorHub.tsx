import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  ColorInput,
  Group,
  MantineProvider,
  Menu,
  Modal,
  MultiSelect,
  Popover,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip
} from '@mantine/core'
import {
  IconArrowLeft,
  IconHelpCircle,
  IconPhoto,
  IconMusic,
  IconVideo,
  IconSparkles,
  IconAlertCircle
} from '@tabler/icons-react'
import { StateMessage } from '../../shared/PageState'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import { formatFileSize } from '../../shared/formatFileSize'
import { isAnimatedMedia, isEditableOriginalImage } from '../media/mediaApi'
import { ensureWorkspaceState, readWorkspaceState } from '../../shared/workspaceState'
import {
  readWorkspaceRecords,
  type WorkspaceAsset,
  type WorkspaceRecord
} from '../../../src/features/workspaces/model/workspaceModel'
import { collectWorkspaceMaterials } from '../../../src/features/workspaces/model/workspaceMaterialsPool'
import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'
import {
  createWorkspaceWorksRepository,
  type ProductionDraft,
  type WorkspaceWork
} from '../../../src/features/workspaces/model/workspaceWorks'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import {
  createImageLayer,
  createStudioDocument,
  type StudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel'
import ImageStudio from './ImageStudio'
import AudioStudio from './AudioStudio'
import VideoStudio from './VideoStudio'
import AIStudio from './AIStudio'
import AICreationTabs from './AICreationTabs'
import { useEditorNavigation } from '../../design/navigation'
import './editor.css'

export type EditorKind = 'image' | 'video' | 'audio' | 'ai-image' | 'ai-audio' | 'ai-video'

export interface EditorHubProps {
  kind: EditorKind
  draftId?: string
  mediaPath?: string
  onClose: () => void
  onMediaSaved?: (file: FileNodeInfo, overwrite: boolean) => void
  onBeforeLeaveChange?: RegisterEditorBeforeLeave
}

export interface EditorContext {
  workspaceId: string
  workspace: WorkspaceRecord
  work: WorkspaceWork
  draft: ProductionDraft
  assets: WorkspaceAsset[]
  assetInfo: Record<string, FileNodeInfo>
  readonly: boolean
}

export type RegisterEditorBeforeLeave = (handler: (() => Promise<boolean>) | null) => void

export interface MediaImageSession {
  file: FileNodeInfo
  record?: {
    id: string
    updated_at: string
    document: StudioDocument
    asset_info: Record<string, FileNodeInfo>
    export_area: 'content' | 'canvas'
  }
  initialDocument: StudioDocument
}

const editorTitles: Record<EditorKind, string> = {
  image: '图片画布',
  audio: '音频制作',
  video: '视频剪辑',
  'ai-image': 'AI 图片',
  'ai-audio': 'AI 音频',
  'ai-video': 'AI 视频'
}

const editorTheme = {
  components: {
    Modal: Modal.extend({ defaultProps: { portalProps: { target: '.react-editor-shell' } } }),
    Menu: Menu.extend({ defaultProps: { withinPortal: false } }),
    Popover: Popover.extend({ defaultProps: { withinPortal: false } }),
    Select: Select.extend({ defaultProps: { comboboxProps: { withinPortal: false } } }),
    MultiSelect: MultiSelect.extend({ defaultProps: { comboboxProps: { withinPortal: false } } }),
    ColorInput: ColorInput.extend({ defaultProps: { popoverProps: { withinPortal: false } } })
  }
}

const shortcuts: Record<EditorKind, [string, string][]> = {
  image: [
    ['Ctrl / ⌘ + S', '保存制作文件'],
    ['Ctrl / ⌘ + Z', '撤销画布编辑'],
    ['Ctrl / ⌘ + Shift + Z 或 Ctrl / ⌘ + Y', '重做画布编辑'],
    ['Ctrl / ⌘ + C / V', '复制或粘贴图层、分组'],
    ['Ctrl / ⌘ + G', '将选中图层编组，或解散选中分组'],
    ['方向键 / Shift + 方向键', '移动选中图层 1 / 10 像素'],
    ['空格 + 拖动', '平移画布'],
    ['Delete / Backspace', '删除选中图层'],
    ['Ctrl / ⌘ + Enter（文字编辑时）', '完成画布文字编辑'],
    ['Esc', '退出比较或当前工具，并取消选择']
  ],
  audio: [
    ['空格', '播放或暂停试听'],
    ['Ctrl / ⌘ + S', '保存制作文件'],
    ['Ctrl / ⌘ + Z', '撤销时间线操作'],
    ['Ctrl / ⌘ + Shift + Z 或 Ctrl / ⌘ + Y', '重做时间线操作'],
    ['S', '在播放头分割选中片段'],
    ['M', '在播放头添加标记'],
    ['Delete / Backspace', '删除选中的片段、文字或标记'],
    ['Shift + 拖动 / 裁剪', '临时关闭时间线吸附'],
    ['Ctrl / ⌘ + 滚轮', '缩放时间线'],
    ['Enter（文字片段编辑时）', '进入或完成就地文字编辑'],
    ['Esc（文字片段编辑时）', '结束就地文字编辑']
  ],
  video: [
    ['空格', '播放或暂停'],
    ['Ctrl / ⌘ + S', '保存制作文件'],
    ['Delete / Backspace', '删除选中片段、字幕或标记']
  ],
  'ai-image': [
    ['Ctrl / ⌘ + S', '保存画布、提示词和当前设置'],
    ['Ctrl / ⌘ + Enter', '提交当前图片生成或编辑任务'],
    ['Ctrl / ⌘ + Z / Y（编辑画布时）', '撤销或重做画布操作'],
    ['Ctrl / ⌘ + Shift + Z（编辑画布时）', '重做画布操作'],
    ['V（编辑画布时）', '切回选择工具'],
    ['Delete（编辑画布时）', '删除选中提示框或箭头'],
    ['Enter（裁剪时）', '应用当前裁剪'],
    ['Esc（编辑画布时）', '取消当前工具、裁剪或选中项']
  ],
  'ai-audio': [],
  'ai-video': []
}

const helpContent: Record<EditorKind, { intro: string; tools: string[] }> = {
  image: {
    intro:
      '在画布中组合图片、文字和分组，调整布局后保存或导出。右侧上方管理图层和顺序，下方调整画布或选中图层属性。',
    tools: [
      '左侧工具用于选择、移动、缩放和裁剪图层；撤销、重做与调整前对比可检查修改。底部素材条支持查看、新增图层和替换当前图片图层。',
      '保存范围可选内容区或整个画布。工作区制作文件可导出到工作区或下载图片；选整张画布、单图层或已有分组可建立关联的 AI 制作文件。'
    ]
  },
  audio: {
    intro:
      '用声音轨、文字轨和时间线制作音频。可加入音频或视频中的声音，设置片段速度、音量、淡入淡出，并导出混音。',
    tools: [
      '左侧工具依次添加声音轨、文字轨，导入 LRC/SRT/VTT/TXT，分割片段、添加标记，以及撤销、重做和适应时间线。文字片段可在时间线直接编辑。',
      '拖动片段或边缘时可吸附播放头、标记和其他片段边缘；右侧查看混音电平和峰值提示，调整轨道与片段属性。录音和自动转写尚未接入。'
    ]
  },
  video: {
    intro: '将图片或视频放入画面轨，将音频放入声音轨，配合字幕和标记制作 MP4 成片。',
    tools: [
      '左侧可从媒体库加入素材、添加字幕或标记，并在播放头拆分片段。时间线支持片段拖动、边缘裁剪、吸附和缩放。',
      '右侧可调整选中片段的时间和速度，编辑字幕与标记，并设置视频画布尺寸；预览后使用导出操作渲染成片。'
    ]
  },
  'ai-image': {
    intro:
      '在 AI 图片内选择图片生成或图片编辑。生成只用文字描述；编辑以一张主图和可选参考图为输入。',
    tools: [
      '图片编辑画布支持涂抹、遮罩、擦除、提示框、箭头、裁剪、缩放及参考图画布；提交时使用实际合成后的画面。',
      '右侧选择图像模型或工作流，并填写提示词、比例及工作流参数。素材预览可借用已有生成提示词；任务与产物在面板中查看。提交任务可能调用已配置的外部 AI 服务。'
    ]
  },
  'ai-audio': {
    intro: 'AI 音频入口预留给后续音频生成与编辑服务。当前没有可提交的创作工具。',
    tools: ['服务、参数和快捷键尚未接入；此入口目前仅用于展示规划中的工具位置。']
  },
  'ai-video': {
    intro: 'AI 视频入口预留给后续图生视频等服务。当前没有可提交的创作工具。',
    tools: ['服务、参数和快捷键尚未接入；此入口目前仅用于展示规划中的工具位置。']
  }
}

async function loadContext(draftId: string): Promise<EditorContext> {
  const workspaceId = localStorage.getItem('omnigallery:workbench-current-workspace') || ''
  if (!workspaceId) throw new Error('请先在工作台选择工作区')
  const settings = await apiFetch<{
    is_readonly: boolean
    app_fe_setting?: { workbench_projects?: unknown }
  }>('/global_setting')
  const workspace = readWorkspaceRecords(settings.app_fe_setting?.workbench_projects).find(
    (item) => item.id === workspaceId
  )
  if (!workspace) throw new Error('工作区已不存在，请返回工作台刷新')
  await ensureWorkspaceState(workspaceId, settings.is_readonly)
  const works = createWorkspaceWorksRepository(workspaceId, readWorkspaceState(workspaceId)).load()
    .works
  const work = works.find((item) => item.drafts.some((draft) => draft.id === draftId))
  const draft = work?.drafts.find((item) => item.id === draftId)
  if (!work || !draft) throw new Error('制作文件已不存在，请返回工作台刷新')
  const [artifacts, inputs] = await Promise.all([
    apiFetch<WorkspaceArtifact[]>(
      `/workspace_artifacts?workspace_id=${encodeURIComponent(workspaceId)}`
    ).catch(() => []),
    apiFetch<WorkspaceArtifact[]>(
      `/workspace_inputs?workspace_id=${encodeURIComponent(workspaceId)}`
    ).catch(() => [])
  ])
  const created: WorkspaceAsset[] = artifacts
    .filter((item) => !item.input_owner)
    .map((item) => ({
      path: `workspace-artifact:${item.id}`,
      name: item.name,
      kind: item.kind
    }))
  const assets = collectWorkspaceMaterials(workspace, works, created)
  const paths = assets
    .map((asset) => asset.path)
    .filter((path) => !path.startsWith('workspace-artifact:'))
  const mediaInfo = paths.length
    ? await apiFetch<Record<string, FileNodeInfo>>('/batch_get_files_info', {
        method: 'POST',
        body: JSON.stringify({ paths })
      }).catch(() => ({}) as Record<string, FileNodeInfo>)
    : {}
  const assetInfo = { ...mediaInfo }
  for (const item of [...artifacts, ...inputs]) {
    const path = `workspace-artifact:${item.id}`
    assetInfo[path] = {
      workspace_artifact_id: item.id,
      workspace_input_owner: item.input_owner,
      workspace_artifact_source: item.source,
      fullpath: path,
      name: item.name,
      type: 'file',
      size: formatFileSize(item.bytes),
      bytes: item.bytes,
      date: item.created_at,
      created_time: item.created_at,
      is_under_scanned_path: false,
      width: item.width,
      height: item.height
    }
  }
  return { workspaceId, workspace, work, draft, assets, assetInfo, readonly: settings.is_readonly }
}

async function loadMediaImage(
  path: string
): Promise<{ context: EditorContext; media: MediaImageSession }> {
  const [settings, info, history] = await Promise.all([
    apiFetch<{ is_readonly: boolean }>('/global_setting'),
    apiFetch<Record<string, FileNodeInfo>>('/batch_get_files_info', {
      method: 'POST',
      body: JSON.stringify({ paths: [path] })
    }),
    apiFetch<{ record: MediaImageSession['record'] | null }>(
      `/image_edit_history?path=${encodeURIComponent(path)}`
    )
  ])
  const file = info[path]
  if (!file || file.type !== 'file') throw new Error('图片文件不存在或已不可读取')
  if (!isEditableOriginalImage(file)) throw new Error('当前格式或位置不支持调整原图')
  if (await isAnimatedMedia(file)) throw new Error('动态图片暂不支持调整')
  const record = history.record || undefined
  let document = record?.document
  if (!document) {
    let width = Number(file.width) || 0
    let height = Number(file.height) || 0
    if (!width || !height) {
      const image = new window.Image()
      image.src = apiUrl(
        `/file?path=${encodeURIComponent(path)}&t=${encodeURIComponent(file.date || '0')}`
      )
      await image.decode()
      width = image.naturalWidth
      height = image.naturalHeight
    }
    if (width > 16384 || height > 16384 || width * height > 100_000_000)
      throw new Error('图片过大，暂不支持调整')
    if (width < 1 || height < 1) throw new Error('无法读取原图尺寸')
    document = createStudioDocument(file.name.replace(/\.[^.]+$/, ''))
    document.width = width
    document.height = height
    document.background = 'transparent'
    document.layers = [createImageLayer(path, { x: 0, y: 0, width, height }, file.name)]
  }
  const now = new Date().toISOString()
  const assets: WorkspaceAsset[] = Object.values({ ...record?.asset_info, [path]: file })
    .filter((item) => item.type === 'file')
    .map((item) => ({ path: item.fullpath, name: item.name, kind: 'image' }))
  const draft: ProductionDraft = {
    id: document.id,
    name: document.name,
    kind: 'image',
    createdAt: now,
    updatedAt: now,
    brief: ''
  }
  const work: WorkspaceWork = {
    id: 'media-image',
    name: file.name,
    createdAt: now,
    updatedAt: now,
    brief: '',
    assets,
    outputs: [],
    drafts: [draft],
    activeDraftId: draft.id,
    lastTool: 'image'
  }
  const workspace: WorkspaceRecord = {
    id: 'media-image',
    name: '媒体库',
    brief: '',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastTool: 'image',
    assets,
    outputs: [],
    notes: {}
  }
  return {
    context: {
      workspaceId: '',
      workspace,
      work,
      draft,
      assets,
      assetInfo: { ...record?.asset_info, [path]: file },
      readonly: settings.is_readonly
    },
    media: { file, record, initialDocument: document }
  }
}

function icon(kind: EditorKind) {
  if (kind === 'image') return <IconPhoto size={18} />
  if (kind === 'audio') return <IconMusic size={18} />
  if (kind === 'video') return <IconVideo size={18} />
  return <IconSparkles size={18} />
}

export default function EditorHub({
  kind,
  draftId,
  mediaPath,
  onClose,
  onMediaSaved,
  onBeforeLeaveChange
}: EditorHubProps) {
  const navigation = useEditorNavigation()
  const [context, setContext] = useState<EditorContext>()
  const [mediaSession, setMediaSession] = useState<MediaImageSession>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const beforeLeave = useRef<(() => Promise<boolean>) | null>(null)
  const registerBeforeLeave = useCallback<RegisterEditorBeforeLeave>(
    (handler) => {
      beforeLeave.current = handler
      onBeforeLeaveChange?.(handler)
    },
    [onBeforeLeaveChange]
  )

  useEffect(() => () => onBeforeLeaveChange?.(null), [onBeforeLeaveChange])
  async function close() {
    if (leaving) return
    setLeaving(true)
    try {
      if (beforeLeave.current && !(await beforeLeave.current())) return
      onClose()
    } finally {
      setLeaving(false)
    }
  }

  useEffect(() => {
    let live = true
    if (!draftId && !mediaPath) return
    setLoading(true)
    setError('')
    setContext(undefined)
    setMediaSession(undefined)
    const request =
      mediaPath && kind === 'image'
        ? loadMediaImage(mediaPath)
        : draftId
          ? loadContext(draftId)
          : Promise.reject(new Error('缺少制作文件'))
    void request
      .then(
        (result) => {
          if (!live) return
          if ('media' in result) {
            setContext(result.context)
            setMediaSession(result.media)
          } else setContext(result)
        },
        (reason) => {
          if (live) setError(reason instanceof Error ? reason.message : '制作文件读取失败')
        }
      )
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [draftId, mediaPath, kind])

  const title = mediaPath && kind === 'image' ? '编辑图片' : editorTitles[kind]
  return (
    <MantineProvider
      forceColorScheme="dark"
      theme={editorTheme}
      cssVariablesSelector=".react-editor-shell"
      getRootElement={() => shellRef.current ?? undefined}
      withGlobalClasses={false}
    >
      <Box ref={shellRef} className="react-editor-shell" data-editor-kind={kind}>
        <header className="react-editor-header">
          <Group gap="sm" wrap="nowrap">
            <Tooltip label="返回上一页">
              <ActionIcon
                variant="subtle"
                aria-label="返回上一页"
                onClick={() => void close()}
                loading={leaving}
              >
                <IconArrowLeft size={18} />
              </ActionIcon>
            </Tooltip>
            {!kind.startsWith('ai-') && kind !== 'image' && (
              <Group gap={8} wrap="nowrap">
                {icon(kind)}
                <Title order={3}>{title}</Title>
              </Group>
            )}
            {context && !kind.startsWith('ai-') && kind !== 'image' && (
              <>
                <Text c="dimmed" size="sm">
                  /
                </Text>
                <Text size="sm" fw={600} lineClamp={1}>
                  {context.draft.name}
                </Text>
              </>
            )}
            {context?.readonly && !kind.startsWith('ai-') && kind !== 'image' && (
              <Badge variant="light" color="gray">
                只读
              </Badge>
            )}
          </Group>
          <Tooltip label="工具介绍与快捷键">
            <ActionIcon
              variant="subtle"
              aria-label="工具介绍与快捷键"
              onClick={() => setHelpOpen(true)}
            >
              <IconHelpCircle size={19} />
            </ActionIcon>
          </Tooltip>
        </header>
        {loading && (
          <div className="react-editor-status">
            <StateMessage loading title="正在读取制作文件…" />
          </div>
        )}
        {!loading && error && (
          <div className="react-editor-status">
            <StateMessage
              role="alert"
              icon={<IconAlertCircle size={35} stroke={1.4} />}
              title="无法打开制作文件"
              description={error}
            >
              <Button variant="light" onClick={onClose}>
                {mediaPath ? '返回媒体库' : '返回工作台'}
              </Button>
            </StateMessage>
          </div>
        )}
        {!loading && !error && !draftId && !mediaPath && (
          <div className="react-editor-status">
            <StateMessage title="尚未选择制作文件" description="请先在工作台选择制作文件。">
              <Button onClick={onClose}>返回工作台</Button>
            </StateMessage>
          </div>
        )}
        {!loading && context && (
          <main className="react-editor-content">
            {kind === 'image' && (
              <ImageStudio
                key={mediaPath || `${context.workspaceId}:${context.draft.id}`}
                context={context}
                mediaFile={mediaSession}
                onMediaSaved={onMediaSaved}
                onBeforeLeave={registerBeforeLeave}
              />
            )}
            {kind === 'audio' && (
              <AudioStudio context={context} onBeforeLeave={registerBeforeLeave} />
            )}
            {kind === 'video' && (
              <VideoStudio
                key={`${context.workspaceId}:${context.draft.id}`}
                context={context}
                onBeforeLeave={registerBeforeLeave}
              />
            )}
            {kind === 'ai-image' && (
              <AIStudio context={context} onBeforeLeave={registerBeforeLeave} />
            )}
            {(kind === 'ai-audio' || kind === 'ai-video') && (
              <div className="react-ai-placeholder">
                <AICreationTabs
                  active={kind}
                  onChange={(next) => navigation.openEditor(next, context.draft.id)}
                />
                <Stack align="center" justify="center" h="70vh">
                  <Box c="dimmed">{icon(kind)}</Box>
                  <Title order={3}>{title}</Title>
                  <Text c="dimmed">这项创作尚未接入，制作文件和素材仍保留在工作台。</Text>
                </Stack>
              </div>
            )}
          </main>
        )}
        <Modal
          opened={helpOpen}
          onClose={() => setHelpOpen(false)}
          title={`${title} · 使用说明`}
          centered
          size="xl"
        >
          <Stack gap="md">
            <Text size="sm">{helpContent[kind].intro}</Text>
            <Stack gap={5}>
              <Text fw={700} size="sm">
                工具与操作
              </Text>
              {helpContent[kind].tools.map((item) => (
                <Text key={item} size="sm" c="dimmed">
                  {item}
                </Text>
              ))}
              {kind === 'image' && mediaPath && (
                <Text size="sm" c="dimmed">
                  从媒体库调整原图时，可保存副本或确认后覆盖原图；覆盖保留标签和描述，并建立编辑历史及素材快照。
                </Text>
              )}
            </Stack>
            <Text fw={700} size="sm">
              快捷键
            </Text>
            {shortcuts[kind].length ? (
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>快捷键</Table.Th>
                    <Table.Th>作用</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {shortcuts[kind].map(([key, action]) => (
                    <Table.Tr key={key}>
                      <Table.Td>
                        <Text ff="monospace" size="sm">
                          {key}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {kind === 'image' && mediaPath && key === 'Ctrl / ⌘ + S'
                          ? '选择保存副本或覆盖原图'
                          : action}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            ) : (
              <Text size="sm" c="dimmed">
                当前入口没有已绑定的快捷键。
              </Text>
            )}
          </Stack>
        </Modal>
      </Box>
    </MantineProvider>
  )
}
