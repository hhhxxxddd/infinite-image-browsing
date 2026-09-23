<script setup lang="ts">
import { computed } from 'vue'
import type { Tag, TagId } from '@/api/db'
import { groupTags } from '@/util/tagGroups'
import { tagLabel } from '@/util/tagLabel'
import { useTagStore } from '@/store/useTagStore'
import { filterTagTypeLabel } from '@/page/TagSearch/searchFilters'

const model = defineModel<TagId[]>({ required: true })
const props = defineProps<{ tags: Tag[]; placeholder?: string }>()
const store = useTagStore()
const groups = computed(() => groupTags(props.tags).map(group => ({ ...group,
  label: group.key === 'custom' || group.key.startsWith('custom:') ? group.label : filterTagTypeLabel(group.key)
})))
const filterOption = (input: string, option: { label?: string }) =>
  String(option?.label ?? '').toLocaleLowerCase().includes(input.trim().toLocaleLowerCase())
</script>

<template>
  <a-select v-model:value="model" mode="multiple" show-search :placeholder="placeholder"
    :filter-option="filterOption" :list-height="300" option-label-prop="label" :max-tag-count="2">
    <a-select-opt-group v-for="group in groups" :key="group.key" :label="group.label">
      <a-select-option v-for="tag in group.tags" :key="tag.id" :value="tag.id" :label="tagLabel(tag)">
        <span class="grouped-tag-option"><span class="grouped-tag-dot" :style="{ background: store.getColor(tag) }" />{{ tagLabel(tag) }}</span>
      </a-select-option>
    </a-select-opt-group>
  </a-select>
</template>

<style scoped>
.grouped-tag-option{display:inline-flex;align-items:center;gap:8px}
.grouped-tag-dot{width:9px;height:9px;border-radius:50%;flex:none}
</style>
