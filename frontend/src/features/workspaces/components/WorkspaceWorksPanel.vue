<script setup lang="ts">
import { AppstoreOutlined, PlusOutlined, MoreOutlined } from '@ant-design/icons-vue'
import {
  toImageThumbnailUrl,
  toVideoCoverUrl,
  type FileNodeInfo
} from '@/features/media-library/public'
import type { WorkspaceWork } from '../model/workspaceWorks'
const props = defineProps<{
  works: WorkspaceWork[]
  activeId?: string
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
}>()
defineEmits<{
  create: []
  open: [work: WorkspaceWork]
  rename: [work: WorkspaceWork]
  remove: [work: WorkspaceWork]
}>()
function cover(work: WorkspaceWork) {
  const asset = [...work.outputs, ...work.assets].find(
    (item) => item.kind !== 'audio' && props.assetInfo[item.path]
  )
  const file = asset && props.assetInfo[asset.path]
  return file
    ? asset?.kind === 'video'
      ? toVideoCoverUrl(file)
      : toImageThumbnailUrl(file, '500x300')
    : ''
}
</script>
<template>
  <section class="works-section" aria-label="工作区作品">
    <header>
      <h2>
        作品 <small>{{ works.length }}</small>
      </h2>
      <a-button type="primary" :disabled="readonly" @click="$emit('create')"
        ><PlusOutlined />新建作品</a-button
      >
    </header>
    <div v-if="works.length" class="works-grid">
      <article v-for="work in works" :key="work.id" :class="{ selected: activeId === work.id }">
        <button
          class="work-entry"
          type="button"
          :aria-label="`打开作品：${work.name}`"
          @click="$emit('open', work)"
        >
          <span class="work-cover"
            ><img v-if="cover(work)" :src="cover(work)" alt="" /><AppstoreOutlined v-else /><span
              >进入作品 ↗</span
            ></span
          >
          <strong>{{ work.name }}</strong>
          <p>{{ work.brief || '还没有填写创作目标' }}</p>
          <small>{{ work.drafts.length }} 个制作文件 · {{ work.outputs.length }} 份成果</small>
        </button>
        <a-dropdown :trigger="['click', 'contextmenu']"
          ><button class="work-more" type="button" :aria-label="`作品操作：${work.name}`">
            <MoreOutlined /></button
          ><template #overlay
            ><a-menu
              ><a-menu-item :disabled="readonly" @click="$emit('rename', work)"
                >修改名称与目标</a-menu-item
              ><a-menu-divider /><a-menu-item
                :disabled="readonly"
                danger
                @click="$emit('remove', work)"
                >删除作品</a-menu-item
              ></a-menu
            ></template
          ></a-dropdown
        >
      </article>
    </div>
    <div v-else class="works-empty">
      <AppstoreOutlined /><strong>创建一项想完成的作品</strong
      ><span>例如：一部短剧、一支旅行短片，或一组宣传内容。</span>
    </div>
  </section>
</template>
<style scoped>
.works-section {
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
}
h2 {
  font-size: 16px;
  margin: 0;
}
h2 small {
  font-size: 12px;
  color: var(--ui-muted);
  margin-left: 8px;
  font-weight: 400;
}
.works-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
article {
  position: relative;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-surface);
  overflow: hidden;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
article:hover,
article.selected {
  border-color: color-mix(in srgb, var(--primary-color) 45%, var(--ui-border));
}
article:hover {
  box-shadow: 0 8px 24px #0000000a;
}
.work-entry {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding: 0 18px 18px;
  border: 0;
  background: none;
  color: var(--ui-text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.work-cover {
  display: grid;
  place-items: center;
  position: relative;
  height: 150px;
  margin: 0 -18px 4px;
  width: calc(100% + 36px);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--primary-color) 9%, var(--ui-surface-soft)),
    var(--ui-surface)
  );
  font-size: 30px;
  color: var(--primary-color);
  overflow: hidden;
}
.work-cover img {
  height: 100%;
  width: 100%;
  object-fit: cover;
}
.work-cover > span:last-child {
  position: absolute;
  bottom: 10px;
  right: 12px;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--ui-muted);
}
.work-entry strong {
  font-size: 15px;
  overflow-wrap: anywhere;
  padding-right: 28px;
}
.work-entry p {
  font-size: 12px;
  color: var(--ui-muted);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 36px;
  line-height: 1.5;
}
.work-entry small {
  font-size: 11px;
  color: var(--ui-muted);
}
.work-more {
  position: absolute;
  right: 10px;
  top: 166px;
  border: 0;
  background: none;
  color: var(--ui-muted);
  padding: 5px;
  cursor: pointer;
}
.work-entry:focus-visible,
.work-more:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -3px;
}
.works-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 48px 16px;
  border: 1px dashed var(--ui-border);
  border-radius: 14px;
  color: var(--ui-muted);
}
.works-empty > .anticon {
  font-size: 30px;
  color: var(--primary-color);
}
.works-empty strong {
  color: var(--ui-text);
}
.works-empty span {
  font-size: 12px;
}
@media (max-width: 1100px) {
  .works-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 680px) {
  .works-grid {
    grid-template-columns: 1fr;
  }
}
</style>
