<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PlusOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  CustomerServiceOutlined as AudioOutlined,
  RobotOutlined
} from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import type { WorkspaceArtifact } from '../api/workspaceArtifacts'
import { draftKindLabel, type ProductionDraft, type ProductionKind } from '../model/workspaceWorks'
import StudioDraftCard from './StudioDraftCard.vue'
const props = defineProps<{
  workspaceId: string
  workId: string
  drafts: ProductionDraft[]
  activeId?: string
  assetInfo: Record<string, FileNodeInfo>
  artifacts: WorkspaceArtifact[]
  kinds?: ProductionKind[]
  readonly?: boolean
  busyId?: string
  hideHeader?: boolean
}>()
defineEmits<{
  create: [kind: ProductionKind]
  open: [draft: ProductionDraft]
  rename: [draft: ProductionDraft]
  remove: [draft: ProductionDraft]
  publish: [draft: ProductionDraft]
  artifactsChanged: []
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
  <section class="production-drafts" aria-label="制作">
    <header v-if="!hideHeader">
      <h2>
        制作 <small>{{ available.length }}</small>
      </h2>
      <a-dropdown :trigger="['click']"
        ><a-button :disabled="readonly"><PlusOutlined />新建</a-button
        ><template #overlay
          ><a-menu
            ><a-menu-item v-for="kind in options" :key="kind" @click="$emit('create', kind)"
              ><component :is="icons[kind]" /> {{ draftKindLabel(kind) }}</a-menu-item
            ></a-menu
          ></template
        ></a-dropdown
      >
    </header>
    <nav v-if="options.length > 1" aria-label="制作类型">
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
      <StudioDraftCard
        v-for="draft in visible"
        :key="draft.id"
        :item="draft"
        :kind="draft.kind"
        :selected="draft.id === activeId"
        :workspace-id="workspaceId"
        :work-id="workId"
        :asset-info="assetInfo"
        :artifacts="artifacts"
        :drafts="drafts"
        :readonly="readonly || !!busyId"
        :busy="busyId === draft.id"
        @open="$emit('open', draft)"
        @rename="$emit('rename', draft)"
        @delete="$emit('remove', draft)"
        @save="$emit('publish', draft)"
        @artifacts-changed="$emit('artifactsChanged')"
        @open-source="
          (id) => {
            const source = drafts.find((item) => item.id === id)
            if (source) $emit('open', source)
          }
        "
      />
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
  align-items: start;
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
