<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons-vue'
import type { StudioWorkflowParameter } from '../api/imageAi'
import {
  parameterKindLabels,
  parameterSliderRange,
  type WorkflowParameterNode
} from '../model/workflowParameters'
import WorkflowParameterInput from './WorkflowParameterInput.vue'

const props = defineProps<{
  open: boolean
  parameters: StudioWorkflowParameter[]
  nodes: WorkflowParameterNode[]
  initialId?: string
  readonly?: boolean
}>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:parameters': [value: StudioWorkflowParameter[]]
}>()
const selectedId = ref('')
const selected = computed(() =>
  props.parameters.find((parameter) => parameter.id === selectedId.value)
)
const previewValue = ref<string | number | boolean>('')
const originalValue = (nodeId: string, field: string) =>
  props.nodes.find((node) => node.id === nodeId)?.fields.find((item) => item.name === field)?.value
const targetOriginal = computed(() => {
  const target = selected.value?.targets[0]
  return target ? originalValue(target.node_id, target.input) : ''
})
const allowedKinds = computed<StudioWorkflowParameter['kind'][]>(() =>
  typeof targetOriginal.value === 'number'
    ? ['number', 'select']
    : typeof targetOriginal.value === 'boolean'
      ? ['boolean', 'select']
      : ['text', 'select']
)
const sliderWarning = computed(
  () =>
    selected.value?.kind === 'number' &&
    selected.value.number_display === 'slider' &&
    !parameterSliderRange(selected.value)
)

watch(
  () => props.open,
  (open) => {
    if (open && !props.parameters.some((parameter) => parameter.id === selectedId.value))
      selectedId.value =
        props.parameters.find((parameter) => parameter.id === props.initialId)?.id ||
        props.parameters[0]?.id ||
        ''
  },
  { immediate: true }
)
watch(
  () => props.initialId,
  (id) => {
    if (id) selectedId.value = id
  }
)
watch(
  () => props.parameters.map((parameter) => parameter.id),
  (ids) => {
    if (!ids.includes(selectedId.value)) selectedId.value = ids[0] || ''
  }
)
watch(
  [selectedId, () => selected.value?.kind, targetOriginal],
  () => {
    previewValue.value = selected.value?.kind === 'select' ? -1 : (targetOriginal.value ?? '')
  },
  { immediate: true }
)

function update(operation: (parameter: StudioWorkflowParameter) => void) {
  if (!selected.value || props.readonly) return
  const current = JSON.parse(JSON.stringify(selected.value)) as StudioWorkflowParameter
  operation(current)
  emit(
    'update:parameters',
    props.parameters.map((parameter) => (parameter.id === current.id ? current : parameter))
  )
}
function fieldAvailable(nodeId: string, field: string, targetIndex = -1) {
  return !props.parameters.some((parameter) =>
    parameter.targets.some(
      (target, index) =>
        !(parameter.id === selectedId.value && index === targetIndex) &&
        target.node_id === nodeId &&
        target.input === field
    )
  )
}
function nextTarget() {
  for (const node of props.nodes) {
    const field = node.fields.find((field) => fieldAvailable(node.id, field.name))
    if (field) return { node_id: node.id, input: field.name }
  }
  return null
}
const canAdd = computed(() => props.parameters.length < 32 && !!nextTarget())
function addParameter() {
  if (props.readonly || !canAdd.value) return
  const target = nextTarget()
  if (!target) return
  const value = originalValue(target.node_id, target.input)
  const parameter: StudioWorkflowParameter = {
    id: crypto.randomUUID(),
    name: target.input,
    kind: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text',
    number_display: 'input',
    targets: [target],
    options: [],
    minimum: null,
    maximum: null,
    step: null
  }
  selectedId.value = parameter.id
  emit('update:parameters', [...props.parameters, parameter])
}
function removeParameter() {
  if (!selected.value || props.readonly) return
  const index = props.parameters.findIndex((parameter) => parameter.id === selectedId.value)
  const remaining = props.parameters.filter((parameter) => parameter.id !== selectedId.value)
  selectedId.value = remaining[Math.min(index, remaining.length - 1)]?.id || ''
  emit('update:parameters', remaining)
}
function changeKind(kind: StudioWorkflowParameter['kind']) {
  update((parameter) => {
    parameter.kind = kind
    parameter.number_display = 'input'
    if (kind === 'select')
      parameter.options = [
        {
          name: '默认',
          values: parameter.targets.map((target) =>
            String(originalValue(target.node_id, target.input) ?? '')
          )
        }
      ]
    else {
      parameter.targets = parameter.targets.slice(0, 1)
      parameter.options = []
    }
  })
}
function reconcileKind(parameter: StudioWorkflowParameter) {
  if (parameter.kind === 'select') return
  const value = originalValue(parameter.targets[0].node_id, parameter.targets[0].input)
  const kind =
    typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text'
  if (kind !== parameter.kind) {
    parameter.kind = kind
    parameter.number_display = 'input'
  }
}
function changeTarget(index: number, nodeId: string, input?: string) {
  const field =
    input ||
    props.nodes
      .find((node) => node.id === nodeId)
      ?.fields.find((field) => fieldAvailable(nodeId, field.name, index))?.name
  if (!field) return
  update((parameter) => {
    parameter.targets[index] = { node_id: nodeId, input: field }
    for (const option of parameter.options)
      option.values[index] = String(originalValue(nodeId, field) ?? '')
    reconcileKind(parameter)
  })
}
function addTarget() {
  const target = nextTarget()
  if (!target || !selected.value || selected.value.targets.length >= 12) return
  update((parameter) => {
    parameter.targets.push(target)
    for (const option of parameter.options)
      option.values.push(String(originalValue(target.node_id, target.input) ?? ''))
  })
}
function removeTarget(index: number) {
  if (!selected.value || selected.value.targets.length < 2) return
  update((parameter) => {
    parameter.targets.splice(index, 1)
    parameter.options.forEach((option) => option.values.splice(index, 1))
  })
}
function setLimit(key: 'minimum' | 'maximum' | 'step', value: string | number | null) {
  update((parameter) => {
    parameter[key] = value === null || value === '' ? null : Number(value)
  })
}
function addOption() {
  if (!selected.value || selected.value.options.length >= 32) return
  update((parameter) =>
    parameter.options.push({
      name: `选项 ${parameter.options.length + 1}`,
      values: parameter.targets.map((target) =>
        String(originalValue(target.node_id, target.input) ?? '')
      )
    })
  )
}
function targetSummary(parameter: StudioWorkflowParameter) {
  return parameter.targets.map((target) => `${target.node_id} · ${target.input}`).join(' / ')
}
</script>

<template>
  <a-modal
    :open="open"
    title="可调参数"
    centered
    :width="980"
    class="workflow-parameter-modal"
    @cancel="emit('update:open', false)"
  >
    <div class="parameter-workspace">
      <aside class="parameter-sidebar" aria-label="参数列表">
        <div class="parameter-sidebar-heading">
          <strong
            >参数 <span>{{ parameters.length }} / 32</span></strong
          >
          <a-button
            size="small"
            :disabled="readonly || !canAdd"
            aria-label="添加参数"
            @click="addParameter"
            ><PlusOutlined
          /></a-button>
        </div>
        <nav class="parameter-navigation" aria-label="选择参数">
          <button
            v-for="parameter in parameters"
            :key="parameter.id"
            type="button"
            :class="{ active: selectedId === parameter.id }"
            :aria-pressed="selectedId === parameter.id"
            :title="parameter.name"
            @click="selectedId = parameter.id"
          >
            <span class="parameter-summary"
              ><strong>{{ parameter.name || '未命名参数' }}</strong
              ><small>{{ parameterKindLabels[parameter.kind] }}</small></span
            >
            <span class="parameter-mapping-summary" :title="targetSummary(parameter)">{{
              targetSummary(parameter)
            }}</span>
          </button>
        </nav>
        <p v-if="!parameters.length" class="parameter-sidebar-empty">暂无参数</p>
      </aside>

      <div v-if="selected" :key="selected.id" class="parameter-detail">
        <header class="parameter-detail-heading">
          <strong>参数设置</strong
          ><a-button size="small" danger :disabled="readonly" @click="removeParameter"
            ><DeleteOutlined />删除参数</a-button
          >
        </header>
        <section class="parameter-section">
          <div class="parameter-basic-fields">
            <label
              >名称<a-input
                :value="selected.name"
                :disabled="readonly"
                :maxlength="80"
                placeholder="在制作界面显示的名称"
                @update:value="
                  update((parameter) => {
                    parameter.name = $event
                  })
                "
            /></label>
            <label
              >数据类型<a-select
                :value="selected.kind"
                :disabled="readonly"
                :options="
                  allowedKinds.map((kind) => ({ value: kind, label: parameterKindLabels[kind] }))
                "
                @update:value="changeKind($event as StudioWorkflowParameter['kind'])"
            /></label>
          </div>
        </section>

        <section class="parameter-section">
          <div class="parameter-section-heading">
            <h4>字段映射</h4>
            <a-button
              v-if="selected.kind === 'select'"
              type="link"
              size="small"
              :disabled="readonly || selected.targets.length >= 12 || !nextTarget()"
              @click="addTarget"
              ><PlusOutlined />添加字段</a-button
            >
          </div>
          <div
            v-for="(target, targetIndex) in selected.targets"
            :key="targetIndex"
            class="parameter-target-fields"
          >
            <div class="parameter-mapping-fields">
              <label
                >节点<a-select
                  :value="target.node_id"
                  :disabled="readonly"
                  :options="
                    nodes.map((node) => ({
                      value: node.id,
                      label: `${node.id} · ${node.title}`,
                      disabled: !node.fields.some((field) =>
                        fieldAvailable(node.id, field.name, targetIndex)
                      )
                    }))
                  "
                  @update:value="changeTarget(targetIndex, String($event))"
              /></label>
              <label
                >输入字段<a-select
                  :value="target.input"
                  :disabled="readonly"
                  :options="
                    (nodes.find((node) => node.id === target.node_id)?.fields ?? []).map(
                      (field) => ({
                        value: field.name,
                        label: field.name,
                        disabled: !fieldAvailable(target.node_id, field.name, targetIndex)
                      })
                    )
                  "
                  @update:value="changeTarget(targetIndex, target.node_id, String($event))"
              /></label>
              <a-button
                v-if="selected.targets.length > 1"
                class="remove-target"
                :disabled="readonly"
                :aria-label="`移除映射字段 ${targetIndex + 1}`"
                @click="removeTarget(targetIndex)"
                ><DeleteOutlined
              /></a-button>
            </div>
            <div class="parameter-default-value">
              工作流默认值：<code>{{
                String(originalValue(target.node_id, target.input) ?? '')
              }}</code>
            </div>
          </div>
        </section>

        <section v-if="selected.kind === 'number'" class="parameter-section">
          <h4>数值设置</h4>
          <div class="parameter-display-label">
            <span>显示方式</span>
            <div class="parameter-display-buttons" role="group" aria-label="数值显示方式">
              <a-button
                :type="selected.number_display !== 'slider' ? 'primary' : 'default'"
                :aria-pressed="selected.number_display !== 'slider'"
                :disabled="readonly"
                @click="
                  update((parameter) => {
                    parameter.number_display = 'input'
                  })
                "
                >数字输入框</a-button
              >
              <a-button
                :type="selected.number_display === 'slider' ? 'primary' : 'default'"
                :aria-pressed="selected.number_display === 'slider'"
                :disabled="readonly"
                @click="
                  update((parameter) => {
                    parameter.number_display = 'slider'
                  })
                "
                >滑块＋输入框</a-button
              >
            </div>
          </div>
          <div class="parameter-number-bounds">
            <label
              >最小值<a-input-number
                :value="selected.minimum"
                aria-label="最小值"
                :disabled="readonly"
                placeholder="不限"
                @update:value="setLimit('minimum', $event)"
            /></label>
            <label
              >最大值<a-input-number
                :value="selected.maximum"
                aria-label="最大值"
                :disabled="readonly"
                placeholder="不限"
                @update:value="setLimit('maximum', $event)"
            /></label>
            <label
              >步长<a-input-number
                :value="selected.step"
                aria-label="步长"
                :disabled="readonly"
                placeholder="不限"
                @update:value="setLimit('step', $event)"
            /></label>
          </div>
          <p v-if="sliderWarning" class="parameter-warning" role="status">
            设置有效的最小值、最大值和步长后显示滑块；当前使用数字输入框。
          </p>
        </section>

        <section v-if="selected.kind === 'select'" class="parameter-section">
          <div class="parameter-section-heading">
            <h4>选项内容</h4>
            <a-button
              type="link"
              size="small"
              :disabled="readonly || selected.options.length >= 32"
              @click="addOption"
              ><PlusOutlined />添加选项</a-button
            >
          </div>
          <div class="parameter-option-scroll">
            <table class="parameter-options-table">
              <thead>
                <tr>
                  <th>显示名称</th>
                  <th
                    v-for="(target, index) in selected.targets"
                    :key="index"
                    :title="`${target.node_id} · ${target.input}`"
                  >
                    {{ target.input }}<small>节点 {{ target.node_id }}</small>
                  </th>
                  <th class="option-action-cell"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(option, optionIndex) in selected.options" :key="optionIndex">
                  <td>
                    <a-input
                      :value="option.name"
                      :disabled="readonly"
                      :maxlength="80"
                      :aria-label="`选项 ${optionIndex + 1} 名称`"
                      @update:value="
                        update((parameter) => {
                          parameter.options[optionIndex].name = $event
                        })
                      "
                    />
                  </td>
                  <td v-for="(target, targetIndex) in selected.targets" :key="targetIndex">
                    <a-input
                      :value="option.values[targetIndex]"
                      :disabled="readonly"
                      :aria-label="`选项 ${optionIndex + 1} ${target.input} 的值`"
                      @update:value="
                        update((parameter) => {
                          parameter.options[optionIndex].values[targetIndex] = $event
                        })
                      "
                    />
                  </td>
                  <td class="option-action-cell">
                    <a-button
                      type="text"
                      :disabled="readonly || selected.options.length < 2"
                      :aria-label="`删除选项 ${optionIndex + 1}`"
                      @click="
                        update((parameter) => {
                          parameter.options.splice(optionIndex, 1)
                        })
                      "
                      ><DeleteOutlined
                    /></a-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="parameter-section parameter-preview" aria-label="使用时预览">
          <h4>使用时预览</h4>
          <WorkflowParameterInput
            :parameter="selected"
            :value="previewValue"
            :disabled="readonly"
            @update:value="previewValue = $event"
          />
        </section>
      </div>
      <div v-else class="parameter-editor-empty">
        <strong>添加第一个参数</strong>
        <p>从工作流的输入字段中选择需要在制作时调整的内容。</p>
        <a-button :disabled="readonly || !canAdd" @click="addParameter"
          ><PlusOutlined />添加参数</a-button
        >
      </div>
    </div>
    <template #footer
      ><div class="parameter-editor-footer">
        <span>完成配置后，点击“保存工作流”生效。</span
        ><a-button type="primary" @click="emit('update:open', false)">完成配置</a-button>
      </div></template
    >
  </a-modal>
</template>

<style scoped>
.parameter-workspace {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  height: min(68vh, 620px);
  min-height: 280px;
  margin: -4px -4px 0;
}
.parameter-sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 6px 16px 6px 0;
  border-right: 1px solid var(--ui-border);
}
.parameter-sidebar-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 0 4px;
}
.parameter-sidebar-heading strong {
  font-size: 13px;
}
.parameter-sidebar-heading span {
  font-size: 11px;
  font-weight: 400;
  color: var(--ui-muted);
  margin-left: 5px;
}
.parameter-navigation {
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
.parameter-navigation button {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 10px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--ui-text);
  background: transparent;
  cursor: pointer;
  text-align: left;
  min-width: 0;
}
.parameter-navigation button:hover {
  background: var(--ui-surface-soft);
}
.parameter-navigation button.active {
  background: var(--primary-color-1);
  border-color: color-mix(in srgb, var(--primary-color) 40%, var(--ui-border));
}
.parameter-navigation button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.parameter-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.parameter-summary strong {
  flex: 1;
  font-size: 12px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parameter-summary small {
  flex-shrink: 0;
  color: var(--ui-muted);
  font-size: 10px;
  background: var(--ui-surface-soft);
  border-radius: 4px;
  padding: 2px 5px;
}
.parameter-mapping-summary {
  color: var(--ui-muted);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.parameter-sidebar-empty {
  color: var(--ui-muted);
  font-size: 12px;
  text-align: center;
  padding: 16px;
}
.parameter-detail {
  overflow-y: auto;
  min-width: 0;
  padding: 4px 8px 12px 24px;
  scrollbar-gutter: stable;
}
.parameter-detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.parameter-detail-heading strong {
  font-size: 14px;
}
.parameter-section {
  padding-bottom: 20px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--ui-border);
}
.parameter-section:last-child {
  margin-bottom: 0;
  border-bottom: 0;
}
.parameter-section h4 {
  font-size: 12px;
  font-weight: 600;
  margin: 0 0 12px;
}
.parameter-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.parameter-section-heading h4 {
  margin: 0;
}
.parameter-section label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  color: var(--ui-muted);
  font-size: 12px;
}
.parameter-section :deep(.ant-select),
.parameter-section :deep(.ant-input-number) {
  width: 100%;
}
.parameter-basic-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 132px;
  gap: 16px;
}
.parameter-mapping-fields {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}
.parameter-mapping-fields label {
  flex: 1;
}
.parameter-target-fields + .parameter-target-fields {
  margin-top: 16px;
}
.parameter-default-value {
  margin-top: 8px;
  color: var(--ui-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.parameter-default-value code {
  color: var(--ui-text);
}
.parameter-display-label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: var(--ui-muted);
  font-size: 12px;
  margin-bottom: 16px;
}
.parameter-display-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.parameter-number-bounds {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.parameter-warning {
  margin: 12px 0 0;
  padding: 9px 12px;
  border-radius: 6px;
  color: color-mix(in srgb, var(--ui-amber, #a86a08) 80%, var(--ui-text));
  background: color-mix(in srgb, var(--ui-amber, #a86a08) 12%, var(--ui-surface));
  font-size: 11px;
  line-height: 1.6;
}
.parameter-option-scroll {
  overflow-x: auto;
}
.parameter-options-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 11px;
}
.parameter-options-table th {
  color: var(--ui-muted);
  text-align: left;
  font-weight: 400;
  padding: 0 8px 8px 0;
  vertical-align: top;
  min-width: 152px;
  max-width: 220px;
  overflow-wrap: anywhere;
}
.parameter-options-table th small {
  display: block;
  font-size: 10px;
  margin-top: 3px;
}
.parameter-options-table td {
  min-width: 152px;
  padding: 4px 8px 4px 0;
}
.parameter-options-table .option-action-cell {
  min-width: 32px;
  width: 32px;
  padding-right: 0;
}
.parameter-preview {
  background: var(--ui-surface-soft);
  padding: 16px;
  border-radius: 8px;
}
.parameter-editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
}
.parameter-editor-empty strong {
  font-size: 14px;
}
.parameter-editor-empty p {
  color: var(--ui-muted);
  font-size: 12px;
  margin: 0;
}
.parameter-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.parameter-editor-footer span {
  color: var(--ui-muted);
  font-size: 11px;
  text-align: left;
}
@media (max-width: 700px) {
  .parameter-workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    height: 65vh;
  }
  .parameter-sidebar {
    padding: 0 0 12px;
    border-right: 0;
    border-bottom: 1px solid var(--ui-border);
  }
  .parameter-sidebar-heading {
    margin-bottom: 8px;
  }
  .parameter-navigation {
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .parameter-navigation button {
    width: 180px;
    flex-shrink: 0;
    padding: 8px;
  }
  .parameter-detail {
    padding: 16px 2px 4px;
  }
  .parameter-basic-fields {
    grid-template-columns: minmax(0, 1fr) 110px;
    gap: 10px;
  }
  .parameter-mapping-fields {
    flex-wrap: wrap;
  }
  .parameter-mapping-fields label {
    flex: 1 1 140px;
  }
  .parameter-editor-footer span {
    max-width: 65%;
  }
}
</style>
