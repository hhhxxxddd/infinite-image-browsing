import { ActionIcon, Tooltip } from '@mantine/core'
import { IconMovie, IconMusic, IconPhoto } from '@tabler/icons-react'

export type AICreationKind = 'ai-image' | 'ai-audio' | 'ai-video'

const tabs = [
  { kind: 'ai-image', label: 'AI 图片', icon: IconPhoto },
  { kind: 'ai-audio', label: 'AI 音频', icon: IconMusic },
  { kind: 'ai-video', label: 'AI 视频', icon: IconMovie }
] as const

export default function AICreationTabs({
  active,
  onChange,
  disabled = false
}: {
  active: AICreationKind
  onChange: (kind: AICreationKind) => void
  disabled?: boolean
}) {
  return (
    <nav className="react-ai-task-nav" aria-label="AI 创作功能">
      {tabs.map(({ kind, label, icon: Icon }) => (
        <Tooltip key={kind} label={label}>
          <ActionIcon
            size={30}
            variant={active === kind ? 'light' : 'subtle'}
            aria-label={label}
            aria-current={active === kind ? 'page' : undefined}
            disabled={disabled}
            onClick={() => onChange(kind)}
          >
            <Icon size={18} />
          </ActionIcon>
        </Tooltip>
      ))}
    </nav>
  )
}
