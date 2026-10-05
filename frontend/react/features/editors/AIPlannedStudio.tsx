import type { ReactNode } from 'react'
import { Badge, Button, Group, Stack, Text, Title } from '@mantine/core'
import {
  IconBolt,
  IconEdit,
  IconMicrophone,
  IconMovie,
  IconPhoto,
  IconPlayerPlay,
  IconVolume
} from '@tabler/icons-react'
import { useEditorNavigation } from '../../design/navigation'
import type { EditorContext } from './EditorHub'
import AICreationTabs from './AICreationTabs'
import './AIPlannedStudio.css'

const plannedFeatures = {
  'ai-video': [
    { title: '视频生成', description: '根据文字描述生成视频片段', icon: IconMovie },
    { title: '参考图驱动', description: '使用参考图、首尾帧控制画面', icon: IconPhoto },
    { title: '编辑与延长', description: '修改已有片段，继续生成后续画面', icon: IconEdit },
    { title: '口型同步', description: '让人物口型与语音匹配', icon: IconMicrophone }
  ],
  'ai-audio': [
    { title: '配音', description: '根据文本生成语音，选择音色与表达方式', icon: IconMicrophone },
    { title: '音效', description: '根据描述生成环境声与动作音效', icon: IconVolume },
    { title: '音频生成', description: '根据文字描述创作音频片段', icon: IconPlayerPlay }
  ]
} as const

export default function AIPlannedStudio({
  context,
  kind,
  backAction,
  helpAction
}: {
  context: EditorContext
  kind: 'ai-audio' | 'ai-video'
  backAction: ReactNode
  helpAction: ReactNode
}) {
  const navigation = useEditorNavigation()
  const video = kind === 'ai-video'
  const title = video ? 'AI 视频' : 'AI 音频'
  return (
    <div className="react-editor-panel react-ai-studio react-ai-planned-studio">
      <div className="react-editor-toolbar">
        {backAction}
        <Text className="react-image-doc-title" fw={700} size="sm" title={context.draft.name}>
          {context.draft.name}
        </Text>
        {helpAction}
        {context.readonly && (
          <Badge size="xs" variant="light" color="gray">
            只读
          </Badge>
        )}
      </div>
      <div className="react-ai-top-actions" role="group" aria-label="AI 创作功能切换">
        <AICreationTabs
          active={kind}
          onChange={(next) => navigation.openEditor(next, context.draft.id)}
        />
      </div>
      <div className="react-editor-main">
        <div className="react-editor-stage is-ai-planned">
          <div className={`react-ai-planned-preview ${video ? 'is-video' : 'is-audio'}`}>
            {video ? (
              <IconMovie size={44} stroke={1.2} />
            ) : (
              <div className="react-ai-planned-wave" aria-hidden="true">
                {[16, 30, 22, 42, 58, 36, 66, 46, 28, 54, 72, 40, 24, 46, 60, 32, 18].map(
                  (height, index) => (
                    <span key={index} style={{ height }} />
                  )
                )}
              </div>
            )}
            <Stack gap={6} align="center">
              <Title order={3}>{video ? '视频预览区' : '音频试听区'}</Title>
              <Text size="sm" c="dimmed" ta="center">
                {title}接入后，任务结果将在这里展示。
              </Text>
            </Stack>
          </div>
        </div>
        <aside className="react-editor-inspector" aria-label={`${title}规划功能`}>
          <Stack className="react-ai-inspector-scroll" gap="lg">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={700} size="sm">
                {title}
              </Text>
              <Badge color="gray" variant="light" size="sm">
                规划中
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              以下能力尚未接入，当前不会提交 AI 任务。
            </Text>
            <Stack gap="sm">
              {plannedFeatures[kind].map(({ title: feature, description, icon: Icon }) => (
                <section className="react-ai-planned-feature" key={feature}>
                  <Icon size={20} stroke={1.5} />
                  <Stack gap={4}>
                    <Text size="sm" fw={600}>
                      {feature}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {description}
                    </Text>
                  </Stack>
                </section>
              ))}
            </Stack>
          </Stack>
          <footer className="react-ai-inspector-footer">
            <Button fullWidth disabled leftSection={<IconBolt size={17} />}>
              {title} · 规划中
            </Button>
          </footer>
        </aside>
      </div>
    </div>
  )
}
