<script setup lang="ts">
import { computed } from 'vue'
import { refDebounced } from '@vueuse/core'
import { parse } from '@/features/generation-metadata/model/generationInfoParser'
import { generationDetails } from '@/features/generation-metadata/model/generationDetails'
import { readGenerationDraft } from '@/features/generation-metadata/model/generationInfoDraft'
import {
  generationFieldLabel,
  generationFieldTooltip,
  generationResourceLabel
} from '@/features/generation-metadata/model/generationFields'
const props = defineProps<{ raw: string }>()
const settledRaw = refDebounced(
  computed(() => props.raw),
  180
)
const unsupported = computed(() => readGenerationDraft(settledRaw.value).rawPreferred)
const mapping = computed(() => {
  try {
    const meta = parse(settledRaw.value)
    return { meta, ...generationDetails(meta, undefined, undefined, false) }
  } catch {
    return null
  }
})
const example = `a portrait, soft light, <lora:portrait_style:0.8>
Negative prompt: blur
Steps: 20, Sampler: Euler, Schedule type: Karras, CFG scale: 7, Seed: 0, Size: 1024x1024, Model: base.safetensors, VAE: vae.safetensors, Hires upscaler: 4x-UltraSharp, Denoising strength: 0.45`
</script>
<template>
  <aside class="mapping-preview">
    <strong>面板映射预览</strong>
    <p v-if="unsupported">
      这是 JSON、工作流或非标准多行格式，无法可靠映射为分项。保存时保留原文结构。
    </p>
    <template v-else-if="mapping">
      <dl>
        <template v-if="mapping.meta.prompt"
          ><dt>正向提示词</dt>
          <dd>{{ mapping.meta.prompt }}</dd></template
        >
        <template v-if="mapping.meta.negativePrompt"
          ><dt>负向提示词</dt>
          <dd>{{ mapping.meta.negativePrompt }}</dd></template
        >
        <template v-if="mapping.resources.length"
          ><dt>使用资源</dt>
          <dd v-for="(resource, index) in mapping.resources" :key="index">
            {{ generationResourceLabel(resource.type) }} · {{ resource.name
            }}<span v-if="resource.weight != null"> · 权重 {{ resource.weight }}</span>
          </dd></template
        >
        <template
          v-for="entry in mapping.primary.filter((entry) => entry.value !== '')"
          :key="entry.key"
          ><dt :title="generationFieldTooltip(entry.key)">{{ generationFieldLabel(entry.key) }}</dt>
          <dd>{{ entry.value }}</dd></template
        >
      </dl>
      <p v-if="!raw.trim()">输入后实时显示对应的提示词、资源和参数。</p>
      <p>未归类的补充字段保留在原文中，不在详情面板展示。</p>
    </template>
    <p v-else>当前内容无法解析，请检查格式。</p>
    <details>
      <summary>格式与字段示例</summary>
      <p>
        首段 → 正向提示词；Negative prompt: → 负向提示词。参数放在同一行，以逗号分隔；Size 使用
        宽x高。
      </p>
      <p>
        Model → Checkpoint；&lt;lora:名称:权重&gt; → LoRA；VAE → VAE；Hires upscaler →
        Upscaler。手动添加的资源保存在 extraJsonMetaInfo.resources，含 type、name、weight、hash。
      </p>
      <pre>{{ example }}</pre>
    </details>
  </aside>
</template>
<style scoped>
.mapping-preview {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--zp-border);
  border-radius: 8px;
  font-size: 12px;
  color: var(--zp-primary);
}

strong {
  font-size: 13px;
}

dl {
  margin: 10px 0;
}

dt {
  margin-top: 10px;
  font-size: 11px;
  color: var(--zp-secondary);
}

dd {
  margin: 3px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 140px;
  overflow: auto;
  line-height: 1.6;
}

small {
  opacity: 0.7;
}

p {
  font-size: 11px;
  line-height: 1.6;
  color: var(--zp-secondary);
}

summary {
  cursor: pointer;
  color: var(--primary-color);
}

pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  font-size: 11px;
  line-height: 1.6;
}
</style>
