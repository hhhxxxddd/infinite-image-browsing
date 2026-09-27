<script setup lang="ts">
import { computed } from 'vue'
import { parse } from '@/features/generation-metadata/model/generationInfoParser'
import { generationDetails } from '@/features/generation-metadata/model/generationDetails'
const props = defineProps<{ raw: string; width?: number; height?: number }>()
const meta = computed(() => parse(props.raw || ''))
const details = computed(() => generationDetails(meta.value, props.width, props.height))
</script>

<template>
  <div class="generation-details">
    <h4>模型与资源</h4>
    <div v-for="(resource, index) in details.resources" :key="index" class="resource">
      <small>{{
        resource.type === 'model' ? 'Checkpoint' : resource.type === 'lora' ? 'LoRA' : resource.type
      }}</small
      ><strong>{{ resource.name }}</strong
      ><span v-if="resource.hash">{{ resource.hash }}</span
      ><span v-if="resource.weight != null">权重 {{ resource.weight }}</span>
    </div>
    <p v-if="!details.resources.length" class="muted">未记录</p>
    <template
      v-for="item in [
        { key: 'prompt', label: '正向提示词' },
        { key: 'negativePrompt', label: '负向提示词' }
      ]"
      :key="item.key"
      ><h4>{{ item.label }}</h4>
      <pre>{{ meta[item.key] || '未记录' }}</pre>
    </template>
    <h4>生成参数</h4>
    <dl class="primary">
      <div v-for="item in details.primary" :key="item.key">
        <dt>{{ item.key }}</dt>
        <dd>{{ item.value || '未记录' }}</dd>
      </div>
    </dl>
    <details v-if="details.more.length">
      <summary>更多参数</summary>
      <dl>
        <template v-for="item in details.more" :key="item.key"
          ><dt>{{ item.key }}</dt>
          <dd>{{ item.value }}</dd></template
        >
      </dl>
    </details>
    <details v-if="raw">
      <summary>原始生成信息</summary>
      <pre>{{ raw }}</pre>
    </details>
  </div>
</template>

<style scoped>
.generation-details {
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.generation-details h4 {
  font-size: 12px;
  margin: 14px 0 7px;
  color: var(--ui-muted);
}
pre,
dd {
  font: inherit;
  white-space: pre-wrap;
  margin: 0;
  overflow-wrap: anywhere;
}
.resource {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
}
.resource small {
  color: var(--primary-color);
}
.muted,
dt,
summary {
  color: var(--ui-muted);
}
.primary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.primary > div {
  min-width: 0;
  padding: 7px;
  background: var(--ui-surface-soft);
  border-radius: 6px;
}
dl {
  margin: 0;
}
details {
  margin-top: 14px;
}
summary {
  cursor: pointer;
}
details dl,
details pre {
  margin-top: 8px;
}
details dt {
  margin-top: 8px;
}
</style>
