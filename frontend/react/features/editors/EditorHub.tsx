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
  Tabs,
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
import { subscribeArtifactDeletion } from './editorArtifactEvents'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import { formatFileSize } from '../../shared/formatFileSize'
import { imageStudioShortcuts, imageStudioShortcutGroups } from '../../../src/shared/lib/shortcut'
import { isAnimatedMedia, isEditableOriginalImage } from '../media/mediaApi'
import {
  ensureWorkspaceState,
  mutateWorkspaceState,
  readWorkspaceState,
  reloadWorkspaceState
} from '../../shared/workspaceState'
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
import AIPlannedStudio from './AIPlannedStudio'
import EditorRenameButton from './EditorRenameButton'
import './editor.css'

export type EditorKind = 'image' | 'video' | 'audio' | 'ai-image' | 'ai-audio' | 'ai-video'

export interface EditorHubProps {
  kind: EditorKind
  draftId?: string
  mediaPath?: string
  onClose: () => void
  onMediaSaved?: (file: FileNodeInfo, overwrite: boolean) => void
  onMediaRenamed?: (source: string, destination: string) => void
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
  revision: string
  taskIdentity?: { document_key: string; source_path: string }
  record?: {
    id: string
    output_hash: string
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
  image: imageStudioShortcuts.map(({ keys, action }) => [keys, action]),
  audio: [
    ['空格', '播放或暂停试听'],
    ['Ctrl / ⌘ + S', '保存制作文件'],
    ['Ctrl / ⌘ + Z', '撤销时间线操作'],
    ['Ctrl / ⌘ + Shift + Z 或 Ctrl / ⌘ + Y', '重做时间线操作'],
    ['S', '在播放头分割选中片段'],
    ['M', '在播放头添加标记'],
    ['Delete / Backspace', '删除选中的片段、文字或标记'],
    ['Shift + Delete / Backspace', '波纹删除，闭合删除后空出的时间'],
    ['Ctrl / ⌘ + A / C / X / V', '全选 / 复制 / 剪切 / 在播放头粘贴'],
    ['Ctrl / ⌘ + G / Shift + G', '关联 / 解除关联选中的片段'],
    ['Ctrl / ⌘ 或 Shift + 点击', '增减选中项；空白处拖动框选'],
    ['I / O', '以播放头设置入点 / 出点'],
    ['← / →（加 Shift）', '播放头前后移动 0.01 秒（1 秒）'],
    ['Home / End', '跳到开头 / 结尾'],
    ['[ / ]', '上一 / 下一剪辑点或标记'],
    ['拖动途中按 Shift', '临时关闭自动对齐'],
    ['Ctrl / ⌘ + 滚轮', '缩放时间线'],
    ['Enter（文字片段编辑时）', '进入或完成就地文字编辑'],
    ['Esc（文字片段编辑时）', '结束就地文字编辑']
  ],
  video: [
    ['空格', '播放或暂停'],
    ['Ctrl / ⌘ + S', '保存制作文件'],
    ['Ctrl / ⌘ + Z', '撤销时间线操作'],
    ['Ctrl / ⌘ + Shift + Z 或 Ctrl / ⌘ + Y', '重做时间线操作'],
    ['Ctrl / ⌘ + A / C / X / V', '全选音画与字幕 / 复制 / 剪切 / 在播放头粘贴'],
    ['Ctrl / ⌘ 或 Shift + 点击', '增减选中项；空白处拖动框选'],
    ['Delete / Backspace', '删除选中片段、字幕或标记'],
    ['Shift + Delete / Backspace', '波纹删除，闭合删除后空出的时间'],
    ['← / →（加 Shift）', '播放头前后移动 1 帧（10 帧）'],
    ['I / O', '以播放头设置入点 / 出点'],
    ['Home / End', '跳到开头 / 结尾'],
    ['[ / ]', '上一 / 下一剪辑点或标记'],
    ['S / M', '在播放头分割所选片段 / 添加标记'],
    ['拖动途中按 Shift', '临时关闭自动对齐'],
    ['Ctrl / ⌘ + 滚轮', '缩放时间线']
  ],
  'ai-image': [
    ['Ctrl / ⌘ + S', '保存画布、提示词和当前设置'],
    ['Ctrl / ⌘ + Enter', '提交当前图片生成或编辑任务'],
    ['Ctrl / ⌘ + Z / Y（编辑画布时）', '撤销或重做画布操作'],
    ['Ctrl / ⌘ + Shift + Z（编辑画布时）', '重做画布操作'],
    ['V（编辑画布时）', '切回选择工具'],
    ['空格 + 拖动 / 鼠标中键拖动', '平移输入画布'],
    ['滚轮（输入画布上）', '缩放全部输入图片的视图'],
    ['Delete（编辑画布时）', '删除选中提示框或箭头'],
    ['Enter（裁剪时）', '应用当前裁剪'],
    ['Esc（编辑画布时）', '取消当前工具、裁剪或选中项']
  ],
  'ai-audio': [],
  'ai-video': []
}

const helpContent: Record<
  EditorKind,
  { intro: string; tools: (string | { title: string; body: string })[] }
> = {
  image: {
    intro: '左侧添加和编辑，右侧管理图层与属性。',
    tools: [
      {
        title: '选择与图层',
        body: 'Ctrl / Cmd 点击多选，Alt 点击进入成员。右键可复制、排序、编组或删除。'
      },
      {
        title: '内容与模板',
        body: '添加图片、文字、气泡和画框；文字模板可直接搜索。版式保存画框，整页模板保存全部内容。'
      },
      {
        title: '调整与视图',
        body: '裁剪需应用；尺寸与校正立即生效。滚轮缩放视图，空格拖动平移，底部可查看调整前对比。'
      },
      {
        title: 'AI 工具',
        body: '单图片图层可消除、高清化或抠图，采用结果后继续加工；处理中仅能移动。工作区「高级」可送入新建／已有作品，查看产物并继续编辑。'
      },
      {
        title: '图层合成',
        body: '多选图层、分组或画框，右键合成为图片。支持透明底／白底，结果置顶，可撤销。'
      }
    ]
  },
  audio: {
    intro: '用声音轨和文字轨编排内容，试听混音，再导出产物。',
    tools: [
      {
        title: '选取与剪辑',
        body: '点击或框选片段，拖动移动、拖两端裁切。支持多选、关联、复制粘贴和波纹删除。'
      },
      {
        title: '时间与视图',
        body: '播放头、入点和出点可直接输入时间；拖动标尺选范围。缩放后刻度与波形随可见范围更新，轨道在固定区域内滚动。'
      },
      {
        title: '声音与文字',
        body: '左侧“声音编辑”打开淡化和音量曲线，选中点可输入数值；右侧调整声音参数与混音。“文字”统一添加、导入和下载歌词字幕。'
      },
      {
        title: '保存与导出',
        body: '圆点显示保存状态。导出整条时间线或选区，右上任务列表查看进度、取消或打开产物。'
      }
    ]
  },
  video: {
    intro: '用多条画面轨、声音轨和字幕制作视频。',
    tools: [
      {
        title: '选取与剪辑',
        body: '点击或框选片段，拖动移动、拖两端裁切。视频和原声默认关联；支持多选、复制粘贴、插入、覆盖及波纹删除。'
      },
      {
        title: '时间与预览',
        body: '播放头与入出点可输入时间，放大后显示帧级刻度。可见片段按时间抽帧，声音显示波形；大视频可使用代理预览。'
      },
      {
        title: '画面与声音',
        body: '左侧“画面”打开裁剪、动画、转场与调色，“精剪”调整源区间和交界；“声音编辑”打开淡化与音量曲线。右侧调整对象参数与混音，轨道开关在轨道名称旁。'
      },
      {
        title: '保存与导出',
        body: '圆点显示保存状态。导出整条时间线或选区，始终使用原片；右上任务列表查看进度、取消或预览产物。'
      }
    ]
  },
  'ai-image': {
    intro:
      '右上图标切换 AI 图片、音频与视频，旁边可打开制作笔记和任务列表。在 AI 图片内选择图片生成或图片编辑。生成只用文字描述；编辑以一张主图和可选参考图为输入。',
    tools: [
      {
        title: '输入图片',
        body: '主图和参考图同屏展示，点击选中。素材条单击预览，右键设置主图或添加参考图，右侧切换全部／已使用；也可使用配置面板的添加参考图按钮，图片上方可替换或移除。添加数量不限；提交时按编号使用支持的数量，其余保留并提示忽略。'
      },
      {
        title: '编辑与视图',
        body: '调整与图片编辑一致：裁剪可拖动边角、填写宽高或选择比例，应用后生效；尺寸即时生效，可重置。主图可涂抹、画遮罩和提示标注；每张图独立撤销。移动图片仅调整查看位置。'
      },
      {
        title: '提交与结果',
        body: '右侧选择模型或工作流并填写要求。生成结果直接显示在画布，可切换多图、缩放和拖动。右上任务列表查看进度与结果。编辑不支持的参考图或遮罩会提示忽略，画布内容保留。'
      }
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
    apiFetch<{
      record: MediaImageSession['record'] | null
      revision: string
      task_identity?: MediaImageSession['taskIdentity']
    }>(`/image_edit_history?path=${encodeURIComponent(path)}`)
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
    const source = document.layers[0]
    if (source.kind === 'image' && history.task_identity?.source_path !== undefined)
      source.taskSource = { path, revisionPath: history.task_identity.source_path }
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
    media: {
      file,
      record,
      revision: history.revision,
      taskIdentity: history.task_identity,
      initialDocument: document
    }
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
  onMediaRenamed,
  onBeforeLeaveChange
}: EditorHubProps) {
  const [context, setContext] = useState<EditorContext>()
  const [mediaSession, setMediaSession] = useState<MediaImageSession>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const beforeLeave = useRef<(() => Promise<boolean>) | null>(null)
  useEffect(
    () =>
      subscribeArtifactDeletion(({ path }) => {
        // Refresh references without remounting the editor or replacing unsaved document state.
        setContext((current) => {
          if (!current) return current
          const keep = (asset: WorkspaceAsset) => asset.path !== path
          const assetInfo = { ...current.assetInfo }
          delete assetInfo[path]
          return {
            ...current,
            assets: current.assets.filter(keep),
            assetInfo,
            workspace: {
              ...current.workspace,
              assets: current.workspace.assets.filter(keep),
              outputs: current.workspace.outputs.filter(keep)
            },
            work: {
              ...current.work,
              assets: current.work.assets.filter(keep),
              outputs: current.work.outputs.filter(keep)
            }
          }
        })
        if (context?.workspaceId)
          void reloadWorkspaceState(context.workspaceId, context.readonly).catch(() => {})
      }),
    [context?.workspaceId, context?.readonly]
  )
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

  async function renameDraft(name: string) {
    if (!context || context.readonly || mediaPath) throw new Error('当前制作文件无法改名')
    await mutateWorkspaceState(context.workspaceId, (storage) => {
      const repository = createWorkspaceWorksRepository(context.workspaceId, storage)
      const current = repository.load()
      const work = current.works.find((item) => item.id === context.work.id)
      if (!work?.drafts.some((item) => item.id === context.draft.id))
        throw new Error('制作文件已不存在，请返回工作台刷新')
      const now = new Date().toISOString()
      repository.save({
        ...current,
        works: current.works.map((item) =>
          item.id === work.id
            ? {
                ...item,
                updatedAt: now,
                drafts: item.drafts.map((draft) =>
                  draft.id === context.draft.id ? { ...draft, name, updatedAt: now } : draft
                )
              }
            : item
        )
      })
    })
    setContext(
      (current) =>
        current && {
          ...current,
          draft: { ...current.draft, name },
          work: {
            ...current.work,
            drafts: current.work.drafts.map((draft) =>
              draft.id === current.draft.id ? { ...draft, name } : draft
            )
          }
        }
    )
  }
  function mediaRenamed(source: string, destination: string) {
    setContext((current) => {
      if (!current) return current
      const file = current.assetInfo[destination]
      const name = file?.name ?? destination.split(/[\\/]/).pop() ?? destination
      const assets = current.assets.map((asset) =>
        asset.path === source ? { ...asset, path: destination, name } : asset
      )
      return {
        ...current,
        assets,
        draft: { ...current.draft, name: name.replace(/\.[^.]+$/, '') },
        work: { ...current.work, name, assets }
      }
    })
    onMediaRenamed?.(source, destination)
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
  const backAction = (
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
  )
  const helpAction = (
    <Tooltip label="工具介绍与快捷键">
      <ActionIcon variant="subtle" aria-label="工具介绍与快捷键" onClick={() => setHelpOpen(true)}>
        <IconHelpCircle size={19} />
      </ActionIcon>
    </Tooltip>
  )
  const renameAction = context && (
    <EditorRenameButton
      name={context.draft.name}
      disabled={context.readonly}
      onRename={renameDraft}
    />
  )
  return (
    <MantineProvider
      forceColorScheme="dark"
      theme={editorTheme}
      cssVariablesSelector=".react-editor-shell"
      getRootElement={() => shellRef.current ?? undefined}
      withGlobalClasses={false}
    >
      <Box ref={shellRef} className="react-editor-shell" data-editor-kind={kind}>
        {(loading || !context) && (
          <header className="react-editor-header">
            <Group gap="sm" wrap="nowrap">
              {backAction}
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
            {helpAction}
          </header>
        )}
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
                onMediaRenamed={mediaRenamed}
                onRenameDraft={renameDraft}
                onBeforeLeave={registerBeforeLeave}
                backAction={backAction}
                helpAction={helpAction}
              />
            )}
            {kind === 'audio' && (
              <AudioStudio
                key={`${context.workspaceId}:${context.draft.id}`}
                context={context}
                renameAction={renameAction}
                onBeforeLeave={registerBeforeLeave}
                backAction={backAction}
                helpAction={helpAction}
              />
            )}
            {kind === 'video' && (
              <VideoStudio
                key={`${context.workspaceId}:${context.draft.id}`}
                context={context}
                renameAction={renameAction}
                onBeforeLeave={registerBeforeLeave}
                backAction={backAction}
                helpAction={helpAction}
              />
            )}
            {kind === 'ai-image' && (
              <AIStudio
                context={context}
                renameAction={renameAction}
                onBeforeLeave={registerBeforeLeave}
                backAction={backAction}
                helpAction={helpAction}
              />
            )}
            {(kind === 'ai-audio' || kind === 'ai-video') && (
              <AIPlannedStudio
                key={`${context.workspaceId}:${context.draft.id}:${kind}`}
                context={context}
                renameAction={renameAction}
                kind={kind}
                onBeforeLeave={registerBeforeLeave}
                backAction={backAction}
                helpAction={helpAction}
              />
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
            <Tabs defaultValue="tools" keepMounted={false}>
              <Tabs.List grow>
                <Tabs.Tab value="tools">工具与操作</Tabs.Tab>
                <Tabs.Tab value="shortcuts">快捷键</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="tools" pt="md">
                <div className={kind === 'image' ? 'editor-help-grid' : 'editor-help-list'}>
                  {helpContent[kind].tools.map((item) =>
                    typeof item === 'string' ? (
                      <Text key={item} size="sm" c="dimmed">
                        {item}
                      </Text>
                    ) : (
                      <Stack key={item.title} gap={4}>
                        <Text fw={700} size="sm">
                          {item.title}
                        </Text>
                        <Text size="sm" c="dimmed">
                          {item.body}
                        </Text>
                      </Stack>
                    )
                  )}
                  {kind === 'image' && (
                    <Stack gap={4}>
                      <Text fw={700} size="sm">
                        保存与导出
                      </Text>
                      <Text size="sm" c="dimmed">
                        {mediaPath
                          ? '保存副本或覆盖原图，重开可继续编辑。'
                          : '制作文件自动保存，可导出到工作区或下载到本机。'}
                        内容区按内容范围输出，整个画布按画布尺寸输出。
                      </Text>
                    </Stack>
                  )}
                </div>
              </Tabs.Panel>
              <Tabs.Panel value="shortcuts" pt="md">
                {kind === 'image' ? (
                  <Stack gap="md">
                    <Text size="xs" c="dimmed">
                      macOS 使用 Cmd（⌘）。输入框、弹窗和已聚焦控件优先使用自身按键。
                    </Text>
                    {imageStudioShortcutGroups.map((group) => (
                      <Stack key={group.title} gap={4} component="section" aria-label={group.title}>
                        <Text size="sm" fw={700}>
                          {group.title}
                        </Text>
                        <Table
                          className="editor-help-shortcuts"
                          horizontalSpacing="xs"
                          verticalSpacing={5}
                        >
                          <Table.Tbody>
                            {group.items.map(({ keys, action }) => (
                              <Table.Tr key={keys}>
                                <Table.Td>
                                  <Text ff="monospace" size="xs">
                                    {keys}
                                  </Text>
                                </Table.Td>
                                <Table.Td>
                                  <Text size="sm">
                                    {keys === 'Ctrl / Cmd + S'
                                      ? mediaPath
                                        ? '选择保存副本或覆盖原图'
                                        : '保存制作文件'
                                      : action}
                                  </Text>
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </Stack>
                    ))}
                  </Stack>
                ) : shortcuts[kind].length ? (
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
                          <Table.Td>{action}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                ) : (
                  <Text size="sm" c="dimmed">
                    当前入口没有已绑定的快捷键。
                  </Text>
                )}
              </Tabs.Panel>
            </Tabs>
          </Stack>
        </Modal>
      </Box>
    </MantineProvider>
  )
}
