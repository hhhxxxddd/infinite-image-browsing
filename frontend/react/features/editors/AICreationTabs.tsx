import { Button } from '@mantine/core'

export type AICreationKind = 'ai-image' | 'ai-audio' | 'ai-video'

const tabs: { kind: AICreationKind; label: string }[] = [
  { kind: 'ai-image', label: 'AI 图片' },
  { kind: 'ai-audio', label: 'AI 音频' },
  { kind: 'ai-video', label: 'AI 视频' }
]

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
      {tabs.map((tab) => (
        <Button
          key={tab.kind}
          size="compact-xs"
          variant={active === tab.kind ? 'light' : 'subtle'}
          aria-current={active === tab.kind ? 'page' : undefined}
          disabled={disabled}
          onClick={() => onChange(tab.kind)}
        >
          {tab.label}
        </Button>
      ))}
    </nav>
  )
}
