<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CloseOutlined, DownOutlined } from '@ant-design/icons-vue'
import type { SearchFilters, Tag, TagId } from '@/api/db'
import { tagLabel } from '@/util/tagLabel'
import { useTagStore } from '@/store/useTagStore'
import { filterTagTypeLabel } from '@/page/TagSearch/searchFilters'
import { groupTags, tagGroupKey } from '@/util/tagGroups'

const model = defineModel<SearchFilters>({ required: true })
const props = defineProps<{ tags: Tag[]; disabled?: boolean }>()
const emit = defineEmits<{ validity: [valid: boolean] }>()
const tagStore = useTagStore()
const searchableTags = computed(() => props.tags.filter(tag => !['size', 'Media Type'].includes(tag.type)))
const groups = computed(() => groupTags(searchableTags.value).map(group => ({
  type: group.key,
  label: group.key === 'custom' || group.key.startsWith('custom:') ? group.label : filterTagTypeLabel(group.key),
  tags: group.tags
})))
const tagSearch = ref('')
const excludeSearch = ref('')
const visibleCounts = ref<Record<string, number>>({})
const matchingTags = (tags: Tag[], query: string) => tags.filter(tag => tagLabel(tag).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
const visibleTags = (tags: Tag[], query: string, key: string) => matchingTags(tags, query).slice(0, visibleCounts.value[key] ?? 40)
const remainingTags = (tags: Tag[], query: string, key: string) => Math.max(0, matchingTags(tags, query).length - (visibleCounts.value[key] ?? 40))
const showMore = (key: string) => { visibleCounts.value = { ...visibleCounts.value, [key]: (visibleCounts.value[key] ?? 40) + 40 } }
watch([tagSearch, excludeSearch], () => { visibleCounts.value = {} })
const selected = (type: string) => Object.values(model.value.tag_groups ?? {}).flat()
  .filter(id => { const tag = props.tags.find(tag => String(tag.id) === String(id)); return tag && tagGroupKey(tag) === type })
const isSelected = (ids: TagId[], id: TagId) => ids.some(value => String(value) === String(id))
const findTag = (id: TagId) => props.tags.find(tag => String(tag.id) === String(id))
const groupSelection = (ids: TagId[]) => {
  const grouped: Record<string, TagId[]> = {}
  for (const id of ids) {
    const tag = findTag(id)
    if (!tag) continue
    const key = tagGroupKey(tag)
    if (!grouped[key]) grouped[key] = []
    if (!isSelected(grouped[key], id)) grouped[key].push(id)
  }
  return grouped
}
watch(() => props.tags.map(tag => `${tag.id}:${tag.group_name}`).join('|'), () => {
  const current = model.value.tag_groups ?? {}
  const normalized = groupSelection(Object.values(current).flat())
  if (JSON.stringify(current) !== JSON.stringify(normalized)) model.value = { ...model.value, tag_groups: normalized }
}, { immediate: true })
const tagColor = (id: TagId) => { const tag = findTag(id); return tag ? tagStore.getColor(tag) : undefined }
const visibleGroups = computed(() => groups.value.filter(group => !tagSearch.value.trim() || matchingTags(group.tags, tagSearch.value).length || selected(group.type).length))
const excludeGroups = computed(() => {
  let remaining = visibleCounts.value.exclude ?? 40
  return groups.value.map(group => {
    const tags = matchingTags(group.tags, excludeSearch.value).slice(0, remaining)
    remaining -= tags.length
    return { ...group, tags }
  }).filter(group => group.tags.length)
})
const excludeTotal = computed(() => matchingTags(searchableTags.value, excludeSearch.value).length)
const excludeRemaining = computed(() => Math.max(0, excludeTotal.value - (visibleCounts.value.exclude ?? 40)))
function toggleTag(type: string, id: TagId) {
  const ids = selected(type)
  const removing = isSelected(ids, id)
  const all = Object.values(model.value.tag_groups ?? {}).flat().filter(value => String(value) !== String(id))
  if (!removing) all.push(id)
  const tag_groups = groupSelection(all)
  model.value = { ...model.value, tag_groups,
    not_tags: removing ? model.value.not_tags : model.value.not_tags.filter(value => String(value) !== String(id)) }
}
function toggleExclude(id: TagId) {
  const ids = model.value.not_tags
  const removing = isSelected(ids, id)
  const tag_groups = groupSelection(Object.values(model.value.tag_groups ?? {}).flat()
    .filter(value => removing || String(value) !== String(id)))
  model.value = { ...model.value, tag_groups, not_tags: removing ? ids.filter(value => String(value) !== String(id)) : [...ids, id] }
}
const presets = [
  { label: '方形', width: 1, height: 1 }, { label: '竖图 2:3', width: 2, height: 3 },
  { label: '竖图 3:4', width: 3, height: 4 }, { label: '竖图 9:16', width: 9, height: 16 },
  { label: '横图 3:2', width: 3, height: 2 }, { label: '横图 4:3', width: 4, height: 3 },
  { label: '横图 16:9', width: 16, height: 9 }, { label: '宽屏 21:9', width: 21, height: 9 }
]
const sizePairValid = (a?: number | null, b?: number | null) => {
  const valid = (value?: number | null) => value == null || (Number.isInteger(value) && value > 0 && value <= 1000000)
  return valid(a) && valid(b) && (a == null) === (b == null)
}
const valid = computed(() => sizePairValid(model.value.dimensions.width, model.value.dimensions.height) &&
  sizePairValid(model.value.dimensions.ratio_width, model.value.dimensions.ratio_height))
// Validity is read by the parent before applying the draft.
defineExpose({ valid })
watch(valid, value => emit('validity', value), { immediate: true })
function setRatio(width?: number, height?: number) {
  model.value = { ...model.value, dimensions: { ...model.value.dimensions, ratio_width: width, ratio_height: height } }
}
function setDimension(key: 'width' | 'height', event: Event) {
  const value = (event.target as HTMLInputElement).value
  model.value = { ...model.value, dimensions: { ...model.value.dimensions, [key]: value ? Number(value) : undefined } }
}
</script>

<template>
  <div class="library-filter-fields">
        <p class="filter-help">同一分组的标签任选其一，不同分组同时满足。选择后点击“应用筛选”更新结果。</p>
    <fieldset :disabled="disabled">
      <section class="filter-section">
        <h3>标签</h3>
        <input v-model="tagSearch" class="tag-search" type="search" aria-label="搜索所有标签" placeholder="搜索所有标签" />
        <div v-for="group in visibleGroups" :key="group.type" class="group-wrapper">
         <details class="tag-group" :key="`${group.type}:${!!tagSearch.trim()}`" :open="!!tagSearch.trim()">
          <summary><span>{{ group.label }}</span><small v-if="selected(group.type).length">已选 {{ selected(group.type).length }}</small><DownOutlined /></summary>
          <div class="tag-group-body">
            <div class="tag-options">
              <button v-for="tag in visibleTags(group.tags, tagSearch, group.type)" :key="tag.id" type="button" class="tag-option" :aria-pressed="isSelected(selected(group.type), tag.id)" @click="toggleTag(group.type, tag.id)">
                <span class="option-check">{{ isSelected(selected(group.type), tag.id) ? '✓' : '' }}</span><a-tag class="option-name" :color="tagStore.getColor(tag)">{{ tagLabel(tag) }}</a-tag><small v-if="tag.count">{{ tag.count }}</small>
              </button>
              <p v-if="!matchingTags(group.tags, tagSearch).length" class="no-tags">没有匹配的标签</p>
              <button v-else-if="remainingTags(group.tags, tagSearch, group.type)" type="button" class="show-more-tags" @click="showMore(group.type)">显示更多（剩余 {{ remainingTags(group.tags, tagSearch, group.type) }} 个）</button>
            </div>
          </div>
         </details>
         <div v-if="selected(group.type).length" class="selected-chips" :aria-label="`${group.label}已选标签`">
           <button v-for="id in selected(group.type)" :key="id" type="button" class="filter-chip" :aria-label="`移除 ${tagLabel(findTag(id) ?? {name: String(id)})}`" @click="toggleTag(group.type, id)"><a-tag :color="tagColor(id)">{{ tagLabel(findTag(id) ?? {name: String(id)}) }}</a-tag><CloseOutlined /></button>
         </div>
        </div>
        <p v-if="!groups.length" class="no-tags">暂无标签。扫描媒体或在设置中添加自定义标签后即可筛选。</p>
        <p v-else-if="!visibleGroups.length" class="no-tags">没有匹配的标签</p>
      </section>
      <section class="filter-section">
        <h3>排除标签</h3>
        <div v-if="model.not_tags.length" class="selected-chips">
          <button v-for="id in model.not_tags" :key="id" type="button" class="filter-chip exclude" :aria-label="`取消排除 ${tagLabel(findTag(id) ?? {name: String(id)})}`" @click="toggleExclude(id)"><a-tag :color="tagColor(id)">{{ tagLabel(findTag(id) ?? {name: String(id)}) }}</a-tag><CloseOutlined /></button>
        </div>
        <details class="tag-group exclude-picker"><summary><span>选择要排除的标签</span><DownOutlined /></summary><div class="tag-group-body">
          <input v-model="excludeSearch" type="search" aria-label="搜索要排除的标签" placeholder="搜索标签" />
          <div class="tag-options">
            <div v-for="group in excludeGroups" :key="group.type">
              <div class="exclude-group-heading">{{ group.label }}</div>
              <button v-for="tag in group.tags" :key="tag.id" type="button" class="tag-option" :aria-pressed="isSelected(model.not_tags, tag.id)" @click="toggleExclude(tag.id)"><span class="option-check">{{ isSelected(model.not_tags, tag.id) ? '✓' : '' }}</span><a-tag class="option-name" :color="tagStore.getColor(tag)">{{ tagLabel(tag) }}</a-tag></button>
            </div>
            <p v-if="!excludeTotal" class="no-tags">没有匹配的标签</p>
            <button v-else-if="excludeRemaining" type="button" class="show-more-tags" @click="showMore('exclude')">显示更多（剩余 {{ excludeRemaining }} 个）</button>
          </div>
        </div></details>
      </section>
      <section class="filter-section">
        <h3>画面比例</h3>
        <div class="ratio-presets">
          <button type="button" :aria-pressed="!model.dimensions.ratio_width" @click="setRatio()">不限</button>
          <button v-for="preset in presets" :key="preset.label" type="button" :aria-pressed="model.dimensions.ratio_width === preset.width && model.dimensions.ratio_height === preset.height" @click="setRatio(preset.width, preset.height)">{{ preset.label }}</button>
        </div>
        <div class="number-pair"><label>自定义比例</label><input type="number" min="1" max="1000000" :value="model.dimensions.ratio_width ?? ''" aria-label="比例宽" placeholder="宽" @input="model.dimensions.ratio_width = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined" /><span>:</span><input type="number" min="1" max="1000000" :value="model.dimensions.ratio_height ?? ''" aria-label="比例高" placeholder="高" @input="model.dimensions.ratio_height = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined" /></div>
      </section>
      <section class="filter-section">
        <h3>精确尺寸</h3>
        <p class="section-note">按图片宽度和高度精确匹配。</p>
        <div class="number-pair"><label>像素尺寸</label><input type="number" min="1" max="1000000" :value="model.dimensions.width ?? ''" aria-label="图片宽度" placeholder="宽" @input="setDimension('width', $event)" /><span>×</span><input type="number" min="1" max="1000000" :value="model.dimensions.height ?? ''" aria-label="图片高度" placeholder="高" @input="setDimension('height', $event)" /></div>
        <p v-if="!valid" class="filter-error" role="alert">宽和高需要同时填写有效的正整数。</p>
      </section>
    </fieldset>
  </div>
</template>

<style scoped>
.library-filter-fields{font-size:12px;color:var(--zp-primary)}.library-filter-fields fieldset{border:0;padding:0;margin:0;min-width:0}.filter-help,.section-note,.no-tags{color:var(--zp-secondary);line-height:1.5}.filter-help{margin:0 0 16px}.filter-section{border-bottom:1px solid var(--zp-border);padding:0 0 16px;margin-bottom:16px}.filter-section h3{font-size:12px;font-weight:600;margin:0 0 10px}.tag-group{border:1px solid var(--zp-border);border-radius:7px;margin:7px 0;overflow:hidden}.tag-group summary{display:flex;align-items:center;gap:8px;min-height:36px;padding:0 10px;cursor:pointer;list-style:none;background:var(--zp-secondary-background)}.tag-group summary::-webkit-details-marker{display:none}.tag-group summary span{flex:1}.tag-group summary small{color:var(--primary-color)}.tag-group summary .anticon{margin-left:auto;color:var(--zp-secondary);font-size:10px}.tag-group[open] summary .anticon{transform:rotate(180deg)}.tag-group-body{padding:10px}.tag-group-body>input{width:100%;height:32px;border:1px solid var(--zp-border);border-radius:5px;background:var(--zp-primary-background);color:var(--zp-primary);padding:0 9px;outline:none}.tag-group-body>input:focus{border-color:var(--primary-color)}.selected-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 9px}.filter-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--zp-border);background:var(--zp-secondary-background);color:var(--zp-primary);border-radius:16px;padding:3px 8px;font:inherit;cursor:pointer}.filter-chip:hover{border-color:var(--primary-color)}.filter-chip .anticon{font-size:9px}.filter-chip.exclude{color:#b84646}.tag-options{max-height:170px;overflow:auto;margin-top:6px}.tag-option{display:flex;align-items:center;gap:8px;width:100%;padding:7px 5px;border:0;border-radius:4px;background:transparent;color:var(--zp-primary);text-align:left;font:inherit;cursor:pointer}.tag-option:hover,.tag-option[aria-pressed="true"]{background:var(--primary-color-1)}.option-check{width:14px;color:var(--primary-color)}.option-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tag-option small{color:var(--zp-secondary)}.no-tags{margin:8px 2px}.exclude-picker summary{justify-content:space-between}.ratio-presets{display:flex;flex-wrap:wrap;gap:6px}.ratio-presets button{border:1px solid var(--zp-border);border-radius:6px;padding:6px 9px;color:var(--zp-primary);background:var(--zp-primary-background);font:inherit;cursor:pointer}.ratio-presets button[aria-pressed="true"]{border-color:var(--primary-color);background:var(--primary-color-1);color:var(--primary-color)}.number-pair{display:flex;align-items:center;gap:6px;margin-top:12px}.number-pair label{min-width:78px;color:var(--zp-secondary)}.number-pair input{width:0;flex:1;min-width:0;height:30px;border:1px solid var(--zp-border);border-radius:5px;padding:0 6px;background:var(--zp-primary-background);color:var(--zp-primary);font:inherit}.section-note{margin:0}.filter-error{color:#d4380d;margin:8px 0 0}
</style>

<style scoped>
.tag-search{width:100%;height:34px;padding:0 10px;border:1px solid var(--zp-border);border-radius:6px;background:var(--zp-primary-background);color:var(--zp-primary);outline:none;}
.tag-search:focus{border-color:var(--primary-color);}
.tag-group summary>span:first-child{flex:1;min-width:0;}
.tag-group summary>.anticon{flex:none;margin-left:auto;}
.tag-option .option-name{flex:0 1 auto;max-width:calc(100% - 42px);min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tag-option small{margin-left:auto;flex-shrink:0;}
.filter-chip :deep(.ant-tag){margin:0;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.show-more-tags{width:100%;border:0;background:transparent;color:var(--primary-color);font:inherit;text-align:left;cursor:pointer;padding:8px 5px;}
.show-more-tags:hover{text-decoration:underline;}
.exclude-group-heading{margin:8px 4px 2px;padding-bottom:4px;border-bottom:1px solid var(--zp-border);font-weight:600;color:var(--zp-secondary);}
</style>
