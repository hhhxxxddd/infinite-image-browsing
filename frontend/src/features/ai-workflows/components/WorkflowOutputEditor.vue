<script setup lang="ts">
import { computed } from 'vue'
import type { ComfyWorkflow, StudioOutputMapping } from '../api/imageAi'

const props = defineProps<{ workflow: ComfyWorkflow; readonly?: boolean }>()
const mappings = defineModel<StudioOutputMapping[]>({ required: true })
const emit = defineEmits<{ locate: [id: string] }>()
const nodes = computed(() =>
  Object.entries(props.workflow)
    .map(([id, node]) => ({
      id,
      title: node._meta?.title || node.class_type,
      output: /SaveImage|PreviewImage/i.test(node.class_type)
    }))
    .sort((a, b) => Number(b.output) - Number(a.output))
)
function update(index: number, patch: Partial<StudioOutputMapping>) {
  mappings.value = mappings.value.map((item, i) => (i === index ? { ...item, ...patch } : item))
}
function move(index: number, direction: number) {
  const next = index + direction,
    items = [...mappings.value]
  if (next < 0 || next >= items.length) return
  ;[items[index], items[next]] = [items[next], items[index]]
  mappings.value = items
}
function add() {
  if (props.readonly || mappings.value.length >= 16) return
  const node = nodes.value.find(
    (node) => node.output && !mappings.value.some((item) => item.node_id === node.id)
  )
  mappings.value = [...mappings.value, { node_id: node?.id ?? '', label: '' }]
}
</script>

<template>
  <section class="output-editor" aria-label="图片结果映射">
    <header>
      <strong
        >图片结果 <small>{{ mappings.length }} 个映射</small></strong
      ><button type="button" :disabled="readonly || mappings.length >= 16" @click="add">
        ＋ 添加结果
      </button>
    </header>
    <p>按映射顺序保存；每个节点返回的多张图片都会保留。可命名为正面、侧面、背面等。</p>
    <div v-for="(item, index) in mappings" :key="index" class="output-row">
      <span class="output-index">{{ index + 1 }}</span>
      <label
        >结果节点<select
          :value="item.node_id"
          :aria-label="`结果 ${index + 1} 节点`"
          :disabled="readonly"
          @change="update(index, { node_id: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">选择返回图片的节点</option>
          <option v-if="item.node_id && !workflow[item.node_id]" :value="item.node_id">
            {{ item.node_id }} · 节点已不存在
          </option>
          <option
            v-for="node in nodes"
            :key="node.id"
            :value="node.id"
            :disabled="mappings.some((other, i) => i !== index && other.node_id === node.id)"
          >
            {{ node.id }} · {{ node.title }}
          </option>
        </select></label
      >
      <label
        >结果名称<input
          :value="item.label"
          :aria-label="`结果 ${index + 1} 名称`"
          :disabled="readonly"
          maxlength="80"
          placeholder="可选，如正面"
          @input="update(index, { label: ($event.target as HTMLInputElement).value })"
      /></label>
      <div class="output-actions">
        <button
          type="button"
          :disabled="!workflow[item.node_id]"
          :aria-label="`定位结果 ${index + 1}`"
          title="定位节点"
          @click="emit('locate', item.node_id)"
        >
          ↗
        </button>
        <button
          type="button"
          :disabled="readonly || index === 0"
          :aria-label="`上移结果 ${index + 1}`"
          title="上移"
          @click="move(index, -1)"
        >
          ↑
        </button>
        <button
          type="button"
          :disabled="readonly || index === mappings.length - 1"
          :aria-label="`下移结果 ${index + 1}`"
          title="下移"
          @click="move(index, 1)"
        >
          ↓
        </button>
        <button
          type="button"
          :disabled="readonly"
          :aria-label="`删除结果 ${index + 1} 映射`"
          title="删除映射"
          @click="mappings = mappings.filter((_, i) => i !== index)"
        >
          ×
        </button>
      </div>
    </div>
    <p v-if="!mappings.length" role="status">尚未配置图片结果，保存后暂不可运行。</p>
  </section>
</template>

<style scoped>
.output-editor {
  margin: 12px 2px;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
small,
p {
  color: var(--ui-muted);
  font-size: 10px;
  font-weight: 400;
}
p {
  margin: 8px 0;
  line-height: 1.5;
}
button {
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  color: var(--primary-color);
  padding: 4px 7px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
.output-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1.5fr) minmax(80px, 1fr) auto;
  align-items: end;
  gap: 8px;
  margin-top: 9px;
}
.output-index {
  align-self: center;
  color: var(--ui-muted);
  font-size: 11px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  color: var(--ui-muted);
  font-size: 10px;
}
input,
select {
  width: 100%;
  min-width: 0;
  height: 30px;
  box-sizing: border-box;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  color: var(--ui-text);
  padding: 5px 7px;
  font: inherit;
  font-size: 11px;
}
.output-actions {
  display: flex;
  gap: 3px;
  padding-bottom: 2px;
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
@media (max-width: 650px) {
  .output-row {
    grid-template-columns: 18px minmax(0, 1fr) auto;
  }
  .output-row label:nth-of-type(2) {
    grid-column: 2;
  }
  .output-actions {
    grid-column: 3;
    grid-row: span 2;
    align-self: center;
    flex-wrap: wrap;
    max-width: 60px;
  }
}
</style>
