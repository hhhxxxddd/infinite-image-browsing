import { aiImageEditorShortcuts, imageStudioShortcuts } from './shortcut'

export type EditorHelpKind =
  | 'image'
  | 'image-edit'
  | 'video'
  | 'audio'
  | 'audio-preview'
  | 'ai-image-generate'
  | 'ai-image-edit'
  | 'ai-audio'
  | 'ai-video'

interface EditorHelpEntry {
  title: string
  description: string
  details: string[]
  shortcuts: { action: string; keys: string; scope?: string }[]
}

const audioShortcuts = [
  { action: '播放／暂停试听', keys: '空格', scope: '未聚焦输入框时' },
  { action: '在播放头分割选中片段', keys: 'S' },
  { action: '在播放头添加标记', keys: 'M' },
  { action: '删除选中片段或标记', keys: 'Delete / Backspace' },
  { action: '撤销', keys: 'Ctrl / Cmd + Z' },
  { action: '重做', keys: 'Ctrl / Cmd + Shift + Z / Ctrl / Cmd + Y' },
  { action: '拖动时临时跳过吸附', keys: 'Shift + 拖动' },
  { action: '编辑选中的文字片段', keys: 'Enter', scope: '文字片段' },
  { action: '提交片段内文字编辑', keys: 'Ctrl / Cmd + Enter', scope: '文字片段' },
  { action: '取消片段内文字编辑', keys: 'Esc', scope: '文字片段' },
  { action: '关闭编辑器或当前菜单', keys: 'Esc' }
]

export const editorHelp: Record<EditorHelpKind, EditorHelpEntry> = {
  image: {
    title: '图片制作',
    description: '用画布、图层与分组组合图片和文字，编辑后可导出为作品产物。',
    details: ['可在左侧管理图层，在画布移动或裁剪内容，右侧调整选中对象的属性。'],
    shortcuts: imageStudioShortcuts
  },
  'image-edit': {
    title: '图片编辑',
    description: '在图层画布中编辑媒体库图片，可调整图片、文字和分组并保存结果。',
    details: ['在画布操作内容，在右侧调整选中对象的属性。'],
    shortcuts: imageStudioShortcuts.map((item) => ({
      ...item,
      scope: item.scope.replace(/图片制作/g, '图片编辑')
    }))
  },
  video: {
    title: '视频剪辑',
    description: '视频剪辑目前是布局预览，可查看素材与记录制作笔记。',
    details: ['时间线剪辑、预览合成及导出尚未接入；目前没有视频剪辑快捷键。'],
    shortcuts: []
  },
  audio: {
    title: '音频制作',
    description: '在多轨时间线上混合音频或视频中的声音，添加文字轨，并导出 WAV／MP3 产物。',
    details: [
      '拖动片段或边缘可移动、裁剪；靠近边缘、播放头和标记时自动吸附。',
      '右侧可调整音量、淡入淡出和速度；混音音量表会提示过载。'
    ],
    shortcuts: audioShortcuts
  },
  'audio-preview': {
    title: '音频制作布局',
    description: '这是旧版音频制作布局预览，可查看素材和记录制作笔记。',
    details: ['多轨编辑、试听、变速和导出请在音频制作编辑器中进行；当前预览没有快捷键。'],
    shortcuts: []
  },
  'ai-image-generate': {
    title: 'AI 图片生成',
    description: '输入提示词、选择图像模型或工作流，在空画布上生成图片。',
    details: ['生成设置保存在当前制作文件中，提交后可在结果区查看并保存产物。'],
    shortcuts: [
      { action: '保存当前生成设置', keys: 'Ctrl / Cmd + S' },
      { action: '关闭编辑器', keys: 'Esc', scope: '没有打开结果预览时' }
    ]
  },
  'ai-image-edit': {
    title: 'AI 图片编辑',
    description: '选择主图，按需要添加参考图、批注或遮罩，再提交图片编辑任务。',
    details: ['可在同一 AI 制作文件内切换生成与编辑；编辑结果保留对应输入来源。'],
    shortcuts: aiImageEditorShortcuts
  },
  'ai-audio': {
    title: 'AI 音频',
    description: 'AI 音频任务尚未接入。目前可浏览素材、记录制作笔记。',
    details: ['配音、音乐／音效生成和音色处理为后续规划，当前无法提交。'],
    shortcuts: [
      { action: '保存已修改的制作笔记', keys: 'Ctrl / Cmd + S' },
      { action: '关闭编辑器', keys: 'Esc' }
    ]
  },
  'ai-video': {
    title: 'AI 视频',
    description: 'AI 视频任务尚未接入。目前可浏览素材、记录制作笔记。',
    details: ['单图或首尾帧生成视频等任务为后续规划，当前无法提交。'],
    shortcuts: [
      { action: '保存已修改的制作笔记', keys: 'Ctrl / Cmd + S' },
      { action: '关闭编辑器', keys: 'Esc' }
    ]
  }
}
