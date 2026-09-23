<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Tag } from '@/api/db'
import { tagLabel } from '@/util/tagLabel'
import { useTagStore } from '@/store/useTagStore'
import { StarFilled, StarOutlined } from '@/icon'
import { groupTags } from '@/util/tagGroups'

const props = defineProps<{ tags: (Tag & { selected?: boolean })[]; keyPrefix: string; showSelection?: boolean }>()
const tagStore = useTagStore()
const query = ref('')
const matchingTags = computed(() => {
  const value = query.value.trim().toLocaleLowerCase()
  return value ? props.tags.filter(tag => tagLabel(tag).toLocaleLowerCase().includes(value)) : props.tags
})
// Keep the initial menu short. Searching includes every matching tag.
const visibleTags = computed(() => query.value.trim() ? matchingTags.value : matchingTags.value.slice(0, 50))
const visibleGroups = computed(() => groupTags(visibleTags.value))
const visibleEntries = computed(() => visibleGroups.value.flatMap(group => [
  { key: `${props.keyPrefix}heading-${group.key}`, kind: 'heading' as const, label: group.label },
  ...group.tags.map(tag => ({ key: `${props.keyPrefix}${tag.id}`, kind: 'tag' as const, tag }))
]))
</script>

<template>
  <a-menu-item-group class="iib-tag-menu-group">
    <template #title>
      <input v-model="query" type="search" class="iib-tag-menu-search" aria-label="搜索标签" placeholder="搜索标签" @click.stop @mousedown.stop @keydown.stop />
    </template>
    <a-menu-item v-for="entry in visibleEntries" :key="entry.key" :disabled="entry.kind === 'heading'" :class="{ 'iib-tag-menu-heading': entry.kind === 'heading' }">
      <template v-if="entry.kind === 'heading'">{{ entry.label }}</template>
      <span v-else class="iib-tag-menu-row"><a-tag :color="tagStore.getColor(entry.tag)">{{ tagLabel(entry.tag) }}</a-tag><StarFilled v-if="showSelection && entry.tag.selected" /><StarOutlined v-else-if="showSelection" /></span>
    </a-menu-item>
    <a-menu-item v-if="!matchingTags.length" :key="`${keyPrefix}empty`" disabled>没有匹配的标签</a-menu-item>
    <a-menu-item v-else-if="!query.trim() && matchingTags.length > 50" :key="`${keyPrefix}search-hint`" disabled>还有 {{ matchingTags.length - 50 }} 个，输入名称查找</a-menu-item>
  </a-menu-item-group>
</template>

<style>
.iib-tag-menu-group .ant-menu-item-group-title{padding:8px 10px;}
.iib-tag-menu-search{width:100%;min-width:160px;height:30px;border:1px solid var(--zp-border);border-radius:5px;padding:0 8px;background:var(--zp-primary-background);color:var(--zp-primary);outline:none;}
.iib-tag-menu-search:focus{border-color:var(--primary-color);}
.iib-tag-menu-group .ant-menu-item-group-list{max-height:min(50vh,360px);overflow-y:auto;overscroll-behavior:contain;}
.iib-tag-menu-group .iib-tag-menu-heading{height:auto;line-height:1.4;min-height:0;margin:7px 8px 2px;padding:5px 2px;border-bottom:1px solid var(--zp-border);font-size:12px;font-weight:600;color:var(--zp-secondary)!important;cursor:default;}
.iib-tag-menu-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:160px;}
.iib-tag-menu-row .ant-tag{margin:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
</style>
