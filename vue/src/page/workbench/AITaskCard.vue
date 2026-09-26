<script setup lang="ts">
import { Modal } from 'ant-design-vue'
import type { StudioTask } from '@/api/studioTasks'
const props = defineProps<{ task: StudioTask; compact?: boolean }>()
const labels = { queued: '排队中', running: '进行中', completed: '已完成', failed: '失败' }
function showDetails() {
  Modal.info({ title: props.task.name, content: props.task.error ||
    (props.task.state === 'queued' ? '任务已提交，正在等待处理。' : '正在后台处理，完成后会自动保存到工作区素材。'), okText: '知道了' })
}
</script>
<template>
  <button type="button" class="ai-task-card" :class="[task.state, { compact }]" :aria-label="`${task.name} · ${labels[task.state]}`" :title="task.error || `${task.name} · ${labels[task.state]}`" @click="showDetails">
    <span class="task-symbol" aria-hidden="true">{{ task.state === 'failed' ? '!' : '◌' }}</span>
    <span class="task-description"><span v-if="!compact" class="task-name">{{ task.name }}</span><small role="status">{{ labels[task.state] }}</small></span>
  </button>
</template>
<style scoped>
.ai-task-card.ai-task-card{display:flex;align-items:center;gap:7px;flex:none;min-width:120px;max-width:190px;padding:5px 8px;border:1px solid #e9c76e;border-radius:9px;background:color-mix(in srgb,#f6d27a 20%,var(--ui-surface));color:var(--ui-text);cursor:pointer;text-align:left}
.ai-task-card.ai-task-card.compact{position:relative;display:grid;place-items:center;min-width:68px;width:68px;height:68px;padding:3px;box-sizing:border-box;gap:0}
.compact .task-description{position:absolute;bottom:5px;right:5px;padding:1px 3px;border-radius:4px;background:color-mix(in srgb,var(--ui-surface) 94%,transparent);box-shadow:0 1px 4px #0003}
.compact .task-description small{font-size:9px;line-height:14px}
.compact .task-symbol{margin-bottom:12px}
.ai-task-card .task-symbol{display:grid;place-items:center;width:30px;height:30px;flex:none;font-size:24px;color:#b38319}.running .task-symbol{animation:task-spin 1.8s linear infinite}.task-description{display:flex;flex-direction:column;gap:3px;min-width:0}.task-name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px}.task-description small{font-size:10px;color:#9b7417}.ai-task-card.failed{border-color:#df9992}.failed .task-symbol,.failed small{color:#b4473c}.ai-task-card:hover,.ai-task-card:focus-visible{box-shadow:inset 0 0 0 1px currentColor}.ai-task-card:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}@keyframes task-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.running .task-symbol{animation:none}}
</style>
