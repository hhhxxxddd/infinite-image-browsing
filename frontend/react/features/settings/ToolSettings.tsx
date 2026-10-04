import { Badge, Group, Tabs, Text } from '@mantine/core'
import { useState } from 'react'
import type { StudioWorkflowPresetInput } from '../../../src/features/ai-workflows/model/imageAIContracts'
import BuiltinToolSettings from './BuiltinToolSettings'
import WorkflowSettings from './WorkflowSettings'

export default function ToolSettings() {
  const [tab, setTab] = useState<string | null>('builtin')
  const [customDirty, setCustomDirty] = useState(false)
  const [copy, setCopy] = useState<{ key: number; preset?: StudioWorkflowPresetInput }>({ key: 0 })
  return (
    <Tabs value={tab} onChange={setTab} keepMounted>
      <Group justify="space-between" mb="md">
        <Tabs.List>
          <Tabs.Tab value="builtin">内置工具</Tabs.Tab>
          <Tabs.Tab value="custom">
            自定义工作流{' '}
            {customDirty && (
              <Badge size="xs" color="orange">
                未保存
              </Badge>
            )}
          </Tabs.Tab>
        </Tabs.List>
        <Text size="xs" c="dimmed">
          全局共用
        </Text>
      </Group>
      <Tabs.Panel value="builtin">
        <BuiltinToolSettings
          copyDisabled={customDirty}
          onCopy={(preset) => {
            setCopy((current) => ({ key: current.key + 1, preset }))
            setTab('custom')
          }}
        />
      </Tabs.Panel>
      <Tabs.Panel value="custom">
        <WorkflowSettings
          key={copy.key}
          initialPreset={copy.preset}
          onDirtyChange={setCustomDirty}
        />
      </Tabs.Panel>
    </Tabs>
  )
}
