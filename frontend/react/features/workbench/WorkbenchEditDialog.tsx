import { useState } from 'react'
import {
  Alert,
  Button,
  ColorInput,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton
} from '@mantine/core'
import { IconDots, IconSparkles } from '@tabler/icons-react'
import type { ProductionKind } from '../../../src/features/workspaces/model/workspaceWorks'
import { readWorkspaceColor } from '../../../src/features/workspaces/model/workspaceColor'
import { workbenchAccentProps, workbenchColorPresets } from './workbenchColors'

export interface EditDialog {
  entity: 'workspace' | 'work' | 'draft'
  id?: string
  newId?: string
  name: string
  brief: string
  kind?: ProductionKind | 'ai-generation'
  color?: string
}

export default function WorkbenchEditDialog({
  initial,
  busy,
  error,
  choices,
  onClose,
  onSave
}: {
  initial: EditDialog
  busy: boolean
  error: string
  choices: { label: string; value: string }[]
  onClose: () => void
  onSave: (dialog: EditDialog) => Promise<void>
}) {
  // Typing and color-picker dragging update this form, not the cards behind it.
  const [form, setForm] = useState(initial)
  const color = readWorkspaceColor(form.color)
  const invalidColor = !!form.color?.trim() && !color
  const entity =
    form.entity === 'workspace' ? '工作区' : form.entity === 'work' ? '作品' : '制作文件'
  return (
    <Modal
      opened
      onClose={() => {
        if (!busy) onClose()
      }}
      title={form.id ? `修改${entity}信息` : `新建${entity}`}
      centered
      size="md"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && form.name.trim() && !invalidColor) void onSave({ ...form, color })
        }}
      >
        <Stack>
          <TextInput
            autoFocus
            label="名称"
            placeholder="输入名称"
            maxLength={80}
            value={form.name}
            disabled={busy}
            onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
            required
          />
          {form.entity === 'draft' && !form.id && (
            <Select
              label="制作类型"
              value={form.kind}
              data={choices}
              disabled={busy}
              onChange={(value) => setForm({ ...form, kind: value as EditDialog['kind'] })}
            />
          )}
          <Textarea
            label={form.entity === 'draft' ? '制作笔记' : '目标与说明'}
            placeholder="记录想法和目标"
            autosize
            minRows={3}
            maxRows={6}
            maxLength={form.entity === 'workspace' ? 500 : 5000}
            value={form.brief}
            disabled={busy}
            onChange={(event) => setForm({ ...form, brief: event.currentTarget.value })}
          />
          {form.entity !== 'draft' && (
            <fieldset className="wb-color-picker" disabled={busy}>
              <legend>颜色</legend>
              <div className="wb-color-options" role="group" aria-label="颜色预设">
                <UnstyledButton
                  type="button"
                  className="wb-color-option"
                  aria-pressed={!form.color}
                  onClick={() => setForm({ ...form, color: undefined })}
                >
                  <span className="wb-color-swatch wb-color-auto">
                    <IconSparkles size={17} />
                  </span>
                  <span>自动</span>
                </UnstyledButton>
                {workbenchColorPresets.map((preset) => (
                  <UnstyledButton
                    key={preset.id}
                    type="button"
                    className="wb-color-option"
                    aria-label={`颜色：${preset.name}`}
                    aria-pressed={color === preset.color}
                    onClick={() => setForm({ ...form, color: preset.color })}
                  >
                    <span className="wb-color-swatch" style={{ background: preset.color }} />
                    <span>{preset.name}</span>
                  </UnstyledButton>
                ))}
              </div>
              <ColorInput
                mt="sm"
                label="自定义颜色"
                placeholder="#RRGGBB"
                format="hex"
                value={form.color ?? ''}
                disabled={busy}
                onChange={(value) => setForm({ ...form, color: value.trim() || undefined })}
                fixOnBlur={false}
                withEyeDropper={false}
                popoverProps={{ withinPortal: false }}
                error={invalidColor ? '请输入有效的十六进制颜色，如 #B9D0DE' : undefined}
                description="可用色盘选色，也可以输入色值；选择“自动”恢复默认搭配。"
              />
              <div
                className="wb-color-preview"
                {...workbenchAccentProps(form.id ?? form.newId ?? 'preview', form.color)}
              >
                <Text size="xs" fw={650} c="var(--wb-accent-ink)">
                  外观预览
                </Text>
                <Text fw={650}>{form.name.trim() || entity}</Text>
                <IconDots className="wb-color-preview-more" size={18} aria-hidden />
              </div>
            </fieldset>
          )}
          <Group justify="flex-end">
            <Button type="button" variant="default" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" loading={busy} disabled={!form.name.trim() || invalidColor}>
              保存
            </Button>
          </Group>
          {error && <Alert color="red">{error}</Alert>}
        </Stack>
      </form>
    </Modal>
  )
}
