<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PlusOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  CustomerServiceOutlined as AudioOutlined,
  RobotOutlined,
  MoreOutlined
} from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import type { WorkspaceArtifact } from '../api/workspaceArtifacts'
import { draftKindLabel, type ProductionDraft, type ProductionKind } from '../model/workspaceWorks'
import StudioDraftCard from './StudioDraftCard.vue'
const props = defineProps<{
  workspaceId: string
  drafts: ProductionDraft[]
  activeId?: string
  assetInfo: Record<string, FileNodeInfo>
  artifacts: WorkspaceArtifact[]
  kinds?: ProductionKind[]
  readonly?: boolean
  busyId?: string
}>()
defineEmits<{
  create: [kind: ProductionKind]
  open: [draft: ProductionDraft]
  rename: [draft: ProductionDraft]
  remove: [draft: ProductionDraft]
  publish: [draft: ProductionDraft, sync: boolean]
}>()
const filter = ref<ProductionKind | 'all'>('all')
const icons = {
  image: PictureOutlined,
  video: VideoCameraOutlined,
  audio: AudioOutlined,
  ai: RobotOutlined
}
const options = computed(
  () => props.kinds ?? (['image', 'video', 'audio', 'ai'] as ProductionKind[])
)
const available = computed(() => props.drafts.filter((draft) => options.value.includes(draft.kind)))
const visible = computed(() =>
  available.value.filter(
    (draft) =>
      filter.value === 'all' || !options.value.includes(filter.value) || draft.kind === filter.value
  )
)
</script>
<template>
  <section class="production-drafts" aria-label="制作草稿">
    <header>
      <h2>
        制作草稿 <small>{{ available.length }}</small>
      </h2>
      <a-dropdown :trigger="['click']"
        ><a-button :disabled="readonly"><PlusOutlined />新建草稿</a-button
        ><template #overlay
          ><a-menu
            ><a-menu-item v-for="kind in options" :key="kind" @click="$emit('create', kind)"
              ><component :is="icons[kind]" /> {{ draftKindLabel(kind) }}</a-menu-item
            ></a-menu
          ></template
        ></a-dropdown
      >
    </header>
    <nav v-if="options.length > 1" aria-label="草稿类型">
      <button type="button" :class="{ active: filter === 'all' }" @click="filter = 'all'">
        全部</button
      ><button
        v-for="kind in options"
        :key="kind"
        type="button"
        :class="{ active: filter === kind }"
        @click="filter = kind"
      >
        {{ draftKindLabel(kind) }}
        <small>{{ available.filter((d) => d.kind === kind).length }}</small>
      </button>
    </nav>
    <div v-if="visible.length" class="draft-grid">
      <article
        v-for="draft in visible"
        :key="draft.id"
        :class="{ selected: draft.id === activeId }"
      >
        <StudioDraftCard
          v-if="draft.kind === 'image'"
          :item="draft"
          :workspace-id="workspaceId"
          :asset-info="assetInfo"
          :artifacts="artifacts"
          :readonly="readonly || !!busyId"
          :busy="busyId === draft.id"
          @open="$emit('open', draft)"
          @rename="$emit('rename', draft)"
          @delete="$emit('remove', draft)"
          @save="$emit('publish', draft, false)"
          @sync="$emit('publish', draft, true)"
        />
        <div v-else class="other-draft">
          <button
            class="draft-entry"
            type="button"
            :aria-label="`打开草稿：${draft.name}`"
            @click="$emit('open', draft)"
          >
            <span class="draft-symbol"
              ><component :is="icons[draft.kind]" /><small>{{
                draftKindLabel(draft.kind)
              }}</small></span
            ><strong>{{ draft.name }}</strong>
            <p>
              {{ draft.brief || (draft.kind === 'ai' ? '主图、参考图与加工记录' : '制作布局预览') }}
            </p>
            <span class="draft-continue">打开草稿 →</span></button
          ><a-dropdown :trigger="['click', 'contextmenu']"
            ><button class="draft-more" type="button" :aria-label="`草稿操作：${draft.name}`">
              <MoreOutlined /></button
            ><template #overlay
              ><a-menu
                ><a-menu-item :disabled="readonly" @click="$emit('rename', draft)"
                  >修改草稿信息</a-menu-item
                ><a-menu-divider /><a-menu-item
                  :disabled="readonly"
                  danger
                  @click="$emit('remove', draft)"
                  >删除草稿</a-menu-item
                ></a-menu
              ></template
            ></a-dropdown
          >
        </div>
      </article>
    </div>
    <div v-else class="draft-empty">
      <span>在同一作品里制作分镜、配音、剪辑和 AI 素材。</span>
      <div>
        <button
          v-for="kind in options"
          :key="kind"
          type="button"
          :disabled="readonly"
          @click="$emit('create', kind)"
        >
          <component :is="icons[kind]" />新建{{ draftKindLabel(kind) }}
        </button>
      </div>
    </div>
  </section>
</template>
<style scoped>
.production-drafts {
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
h2 {
  font-size: 15px;
  margin: 0;
}
h2 small {
  font-size: 11px;
  font-weight: 400;
  color: var(--ui-muted);
  margin-left: 8px;
}
nav {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
nav button {
  border: 0;
  border-radius: 6px;
  padding: 7px 11px;
  background: none;
  color: var(--ui-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
nav button.active {
  background: color-mix(in srgb, var(--primary-color) 10%, var(--ui-surface));
  color: var(--primary-color);
}
nav small {
  margin-left: 4px;
  opacity: 0.7;
}
.draft-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}
.draft-grid article {
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  overflow: hidden;
  min-width: 0;
  background: var(--ui-surface);
}
article.selected {
  border-color: color-mix(in srgb, var(--primary-color) 50%, var(--ui-border));
}
.other-draft {
  position: relative;
  height: 100%;
}
.draft-entry {
  padding: 0 16px 16px;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  border: 0;
  background: none;
  color: var(--ui-text);
  font: inherit;
  cursor: pointer;
}
.draft-symbol {
  margin: 0 -16px 4px;
  width: calc(100% + 32px);
  height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--ui-surface-soft);
  color: var(--primary-color);
  font-size: 30px;
}
.draft-symbol small {
  font-size: 11px;
  color: var(--ui-muted);
}
.draft-entry strong {
  font-size: 14px;
  padding-right: 22px;
  overflow-wrap: anywhere;
}
.draft-entry p {
  font-size: 12px;
  color: var(--ui-muted);
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.draft-continue {
  font-size: 12px;
  color: var(--primary-color);
  margin-top: auto;
  padding-top: 8px;
}
.draft-more {
  position: absolute;
  right: 10px;
  top: 165px;
  border: 0;
  background: none;
  color: var(--ui-muted);
  cursor: pointer;
}
.draft-empty {
  border: 1px dashed var(--ui-border);
  border-radius: 12px;
  padding: 30px 18px;
  text-align: center;
  color: var(--ui-muted);
  font-size: 12px;
}
.draft-empty > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}
.draft-empty button {
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  color: var(--ui-text);
  padding: 8px 12px;
  cursor: pointer;
}
.draft-empty .anticon {
  margin-right: 6px;
}
button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
</style>
