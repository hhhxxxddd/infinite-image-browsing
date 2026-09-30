import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput
} from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  StudioWorkflowParameter,
  StudioWorkflowPresetInput,
  StudioWorkflowSlot
} from '../../../src/features/ai-workflows/api/imageAi'
import { availableScalarFields } from './workflowMapping'

type Props = {
  draft: StudioWorkflowPresetInput
  onChange: (next: StudioWorkflowPresetInput) => void
  disabled?: boolean
  focusedId?: string
}

const keyOf = (target: StudioWorkflowSlot) => JSON.stringify([target.node_id, target.input])
const kindLabels = { number: '数值', text: '文本', boolean: '开关', select: '选项' }
const inferredKind = (value: unknown): StudioWorkflowParameter['kind'] =>
  typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text'

export default function WorkflowParameterSettings({
  draft,
  onChange,
  disabled = false,
  focusedId
}: Props) {
  const [selectedId, setSelectedId] = useState('')
  useEffect(() => {
    if (focusedId) setSelectedId(focusedId)
  }, [focusedId])
  const parameters = draft.parameters || []
  const selected = parameters.find((item) => item.id === selectedId) || parameters[0]
  const fields = useMemo(() => availableScalarFields(draft), [draft])
  const usedByOther = new Set(
    parameters.filter((item) => item.id !== selected?.id).flatMap((item) => item.targets.map(keyOf))
  )
  const optionsFor = (currentKey?: string) =>
    fields
      .filter(
        (field) =>
          !usedByOther.has(keyOf(field)) &&
          (currentKey === keyOf(field) ||
            !selected?.targets.some((target) => keyOf(target) === keyOf(field)))
      )
      .map((field) => ({
        value: keyOf(field),
        label: `${field.node_id} · ${draft.workflow[field.node_id]?._meta?.title || draft.workflow[field.node_id]?.class_type} / ${field.input}`
      }))
  const firstTarget = selected?.targets[0]
  const firstValue = firstTarget && draft.workflow[firstTarget.node_id]?.inputs[firstTarget.input]
  const allowedKinds =
    typeof firstValue === 'number'
      ? ['number', 'select']
      : typeof firstValue === 'boolean'
        ? ['boolean', 'select']
        : ['text', 'select']
  const nextFree = fields.find(
    (field) =>
      !parameters.some((item) => item.targets.some((target) => keyOf(target) === keyOf(field)))
  )

  function replaceParameter(change: (parameter: StudioWorkflowParameter) => void) {
    if (!selected || disabled) return
    const copy = structuredClone(selected)
    change(copy)
    onChange({
      ...draft,
      parameters: parameters.map((item) => (item.id === selected.id ? copy : item))
    })
  }

  function addParameter() {
    if (!nextFree || parameters.length >= 32 || disabled) return
    const parameter: StudioWorkflowParameter = {
      id: crypto.randomUUID(),
      name: nextFree.input,
      kind: inferredKind(nextFree.value),
      number_display: 'input',
      targets: [{ node_id: nextFree.node_id, input: nextFree.input }],
      options: [],
      minimum: null,
      maximum: null,
      step: null
    }
    onChange({ ...draft, parameters: [...parameters, parameter] })
    setSelectedId(parameter.id)
  }

  function changeTarget(index: number, value: string | null) {
    const field = fields.find((candidate) => keyOf(candidate) === value)
    if (!field) return
    replaceParameter((parameter) => {
      parameter.targets[index] = { node_id: field.node_id, input: field.input }
      for (const option of parameter.options) option.values[index] = String(field.value)
      if (index === 0 && parameter.kind !== 'select') {
        parameter.kind = inferredKind(field.value)
        parameter.number_display = 'input'
      }
    })
  }

  function move(index: number, offset: number) {
    const to = index + offset
    if (to < 0 || to >= parameters.length) return
    const next = [...parameters]
    ;[next[index], next[to]] = [next[to], next[index]]
    onChange({ ...draft, parameters: next })
  }

  return (
    <section className="settings-workflow-advanced">
      <Group justify="space-between" align="center">
        <div>
          <Text size="sm" fw={700}>
            制作时可调参数
          </Text>
          <Text size="xs" c="dimmed">
            将未连接的节点字段开放到制作面板，最多 32 项。
          </Text>
        </div>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          disabled={disabled || !nextFree || parameters.length >= 32}
          onClick={addParameter}
        >
          添加参数
        </Button>
      </Group>
      {parameters.length === 0 ? (
        <Text size="xs" c="dimmed" mt="md">
          没有可调参数。
        </Text>
      ) : (
        <div className="settings-workflow-parameter-layout">
          <div className="settings-workflow-parameter-list">
            {parameters.map((parameter, index) => (
              <button
                type="button"
                key={parameter.id}
                className={`settings-workflow-item${selected?.id === parameter.id ? ' is-active' : ''}`}
                onClick={() => setSelectedId(parameter.id)}
              >
                <span>{parameter.name}</span>
                <Badge size="xs" variant="light">
                  {kindLabels[parameter.kind]}
                </Badge>
                <span className="settings-workflow-parameter-order">{index + 1}</span>
              </button>
            ))}
          </div>
          {selected && (
            <Stack gap="sm" className="settings-workflow-parameter-detail">
              <Group justify="space-between">
                <Text size="sm" fw={700}>
                  {selected.name || '未命名参数'}
                </Text>
                <Group gap={3}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="参数上移"
                    disabled={disabled || parameters.indexOf(selected) === 0}
                    onClick={() => move(parameters.indexOf(selected), -1)}
                  >
                    <IconArrowUp size={15} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="参数下移"
                    disabled={disabled || parameters.indexOf(selected) === parameters.length - 1}
                    onClick={() => move(parameters.indexOf(selected), 1)}
                  >
                    <IconArrowDown size={15} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label="删除参数"
                    disabled={disabled}
                    onClick={() => {
                      onChange({
                        ...draft,
                        parameters: parameters.filter((item) => item.id !== selected.id)
                      })
                      setSelectedId('')
                    }}
                  >
                    <IconTrash size={15} />
                  </ActionIcon>
                </Group>
              </Group>
              <div className="settings-workflow-mapping">
                <TextInput
                  label="显示名称"
                  value={selected.name}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    replaceParameter((parameter) => {
                      parameter.name = value
                    })
                  }}
                />
                <Select
                  label="类型"
                  value={selected.kind}
                  data={allowedKinds.map((kind) => ({
                    value: kind,
                    label: kindLabels[kind as StudioWorkflowParameter['kind']]
                  }))}
                  disabled={disabled}
                  onChange={(value) =>
                    value &&
                    replaceParameter((parameter) => {
                      parameter.kind = value as StudioWorkflowParameter['kind']
                      parameter.number_display = 'input'
                      if (value === 'select')
                        parameter.options = [
                          {
                            name: '默认',
                            values: parameter.targets.map((target) =>
                              String(draft.workflow[target.node_id]?.inputs[target.input] ?? '')
                            )
                          }
                        ]
                      else {
                        parameter.targets = parameter.targets.slice(0, 1)
                        parameter.options = []
                      }
                    })
                  }
                />
              </div>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="xs" fw={700}>
                    节点字段
                  </Text>
                  {selected.kind === 'select' && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      disabled={
                        disabled ||
                        selected.targets.length >= 12 ||
                        !fields.some(
                          (field) =>
                            !usedByOther.has(keyOf(field)) &&
                            !selected.targets.some((target) => keyOf(target) === keyOf(field))
                        )
                      }
                      onClick={() => {
                        const free = fields.find(
                          (field) =>
                            !usedByOther.has(keyOf(field)) &&
                            !selected.targets.some((target) => keyOf(target) === keyOf(field))
                        )
                        if (!free) return
                        replaceParameter((parameter) => {
                          parameter.targets.push({ node_id: free.node_id, input: free.input })
                          parameter.options.forEach((option) =>
                            option.values.push(String(free.value))
                          )
                        })
                      }}
                    >
                      添加字段
                    </Button>
                  )}
                </Group>
                {selected.targets.map((target, index) => (
                  <Group key={index} align="end" wrap="nowrap">
                    <Select
                      className="settings-workflow-flex"
                      searchable
                      label={index === 0 ? '节点 / 输入字段' : `字段 ${index + 1}`}
                      value={keyOf(target)}
                      data={optionsFor(keyOf(target))}
                      disabled={disabled}
                      onChange={(value) => changeTarget(index, value)}
                    />
                    {selected.kind === 'select' && selected.targets.length > 1 && (
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`移除字段 ${index + 1}`}
                        disabled={disabled}
                        onClick={() =>
                          replaceParameter((parameter) => {
                            parameter.targets.splice(index, 1)
                            parameter.options.forEach((option) => option.values.splice(index, 1))
                          })
                        }
                      >
                        <IconTrash size={15} />
                      </ActionIcon>
                    )}
                  </Group>
                ))}
              </Stack>
              {selected.kind === 'number' && (
                <>
                  <Switch
                    label="滑块 + 数字输入"
                    checked={selected.number_display === 'slider'}
                    disabled={disabled}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      replaceParameter((parameter) => {
                        parameter.number_display = checked ? 'slider' : 'input'
                      })
                    }}
                  />
                  <div className="settings-workflow-mapping settings-workflow-number-bounds">
                    {(['minimum', 'maximum', 'step'] as const).map((key) => (
                      <NumberInput
                        key={key}
                        label={{ minimum: '最小值', maximum: '最大值', step: '步长' }[key]}
                        value={selected[key] ?? ''}
                        disabled={disabled}
                        onChange={(value) =>
                          replaceParameter((parameter) => {
                            parameter[key] = value === '' ? null : Number(value)
                          })
                        }
                      />
                    ))}
                  </div>
                  {selected.number_display === 'slider' &&
                    (selected.minimum === null ||
                      selected.maximum === null ||
                      selected.step === null ||
                      selected.minimum >= selected.maximum ||
                      selected.step <= 0) && (
                      <Alert color="yellow">
                        设置有效的最小值、最大值和步长后才会显示滑块；否则制作面板使用数字输入框。
                      </Alert>
                    )}
                </>
              )}
              {selected.kind === 'select' && (
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="xs" fw={700}>
                      选项 · {selected.options.length} / 32
                    </Text>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      disabled={disabled || selected.options.length >= 32}
                      onClick={() =>
                        replaceParameter((parameter) =>
                          parameter.options.push({
                            name: `选项 ${parameter.options.length + 1}`,
                            values: parameter.targets.map((target) =>
                              String(draft.workflow[target.node_id]?.inputs[target.input] ?? '')
                            )
                          })
                        )
                      }
                    >
                      添加选项
                    </Button>
                  </Group>
                  {selected.options.map((option, optionIndex) => (
                    <div className="settings-workflow-option" key={optionIndex}>
                      <Group align="end" wrap="nowrap">
                        <TextInput
                          className="settings-workflow-flex"
                          label="显示名称"
                          maxLength={80}
                          value={option.name}
                          disabled={disabled}
                          onChange={(event) => {
                            const value = event.currentTarget.value
                            replaceParameter((parameter) => {
                              parameter.options[optionIndex].name = value
                            })
                          }}
                        />
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`删除选项 ${optionIndex + 1}`}
                          disabled={disabled || selected.options.length < 2}
                          onClick={() =>
                            replaceParameter((parameter) => {
                              parameter.options.splice(optionIndex, 1)
                            })
                          }
                        >
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Group>
                      <div className="settings-workflow-mapping">
                        {selected.targets.map((target, targetIndex) => (
                          <TextInput
                            key={targetIndex}
                            label={`${target.node_id} · ${target.input}`}
                            value={option.values[targetIndex] ?? ''}
                            disabled={disabled}
                            onChange={(event) => {
                              const value = event.currentTarget.value
                              replaceParameter((parameter) => {
                                parameter.options[optionIndex].values[targetIndex] = value
                              })
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </Stack>
              )}
            </Stack>
          )}
        </div>
      )}
    </section>
  )
}
