<script setup lang="ts">
import { tagLabel } from '@/util/tagLabel'
import { computed, nextTick, ref, watch } from 'vue'
import { DownOutlined } from '@ant-design/icons-vue'
import { SearchSelect } from 'vue3-ts-util'
import type { SearchFilters, Tag } from '@/api/db'
import { emptySearchFilters, describeSearchFilters } from './searchFilters'
const model = defineModel<SearchFilters>({ required: true })
const props = defineProps<{ tags: Tag[]; loading?: boolean; panel?: boolean }>()
const emit = defineEmits<{ validity: [valid: boolean]; apply: [] }>()
const selectableTags = computed(() => props.tags.filter(tag => !['size', 'Media Type'].includes(tag.type)))
const conv = { value: (tag: Tag) => tag.id, text: (tag: Tag) => tagLabel(tag) }
const sizePresets = [
  { ratio: '1:1', rw: 1, rh: 1, width: 1024, height: 1024 },
  { ratio: '2:3', rw: 2, rh: 3, width: 1024, height: 1536 },
  { ratio: '3:2', rw: 3, rh: 2, width: 1536, height: 1024 },
  { ratio: '3:4', rw: 3, rh: 4, width: 1152, height: 1536 },
  { ratio: '4:3', rw: 4, rh: 3, width: 1536, height: 1152 },
  { ratio: '9:16', rw: 9, rh: 16, width: 1152, height: 2048 },
  { ratio: '16:9', rw: 16, rh: 9, width: 2048, height: 1152 },
  { ratio: '21:9', rw: 21, rh: 9, width: 2688, height: 1152 }
]
const dimensions = computed(() => model.value.dimensions)
const sizeOpen = ref(false)
const ratioOpen = ref(false)
const tagsOpen = ref(false)
const sizeDraft = ref<{ width?: number | null; height?: number | null }>({})
const ratioDraft = ref<{ width?: number | null; height?: number | null }>({})
const tagsDraft = ref(emptySearchFilters())
const validPair = (width?: number | null, height?: number | null) => {
  const validNumber = (value?: number | null) => value == null || (Number.isInteger(value) && value > 0 && value <= 1000000)
  return validNumber(width) && validNumber(height) && (width == null) === (height == null)
}
const validSize = computed(() => validPair(sizeDraft.value.width, sizeDraft.value.height))
const validRatio = computed(() => validPair(ratioDraft.value.width, ratioDraft.value.height))
const validModel = computed(() => validPair(dimensions.value.width, dimensions.value.height) &&
  validPair(dimensions.value.ratio_width, dimensions.value.ratio_height))
watch(validModel, value => emit('validity', value), { immediate: true })
watch(sizeOpen, open => {
  if (!open) return
  ratioOpen.value = tagsOpen.value = false
  sizeDraft.value = { width: dimensions.value.width, height: dimensions.value.height }
})
watch(ratioOpen, open => {
  if (!open) return
  sizeOpen.value = tagsOpen.value = false
  ratioDraft.value = { width: dimensions.value.ratio_width, height: dimensions.value.ratio_height }
})
watch(tagsOpen, open => {
  if (!open) return
  sizeOpen.value = ratioOpen.value = false
  tagsDraft.value = { ...emptySearchFilters(), and_tags: [...model.value.and_tags],
    or_tags: [...model.value.or_tags], not_tags: [...model.value.not_tags] }
})
watch(model, value => {
  if (!props.panel) return
  sizeDraft.value = { width: value.dimensions.width, height: value.dimensions.height }
  ratioDraft.value = { width: value.dimensions.ratio_width, height: value.dimensions.ratio_height }
  tagsDraft.value = { ...emptySearchFilters(), and_tags: [...value.and_tags], or_tags: [...value.or_tags], not_tags: [...value.not_tags] }
}, { deep: true, immediate: true })
const hasSize = computed(() => dimensions.value.width != null || dimensions.value.height != null)
const hasRatio = computed(() => dimensions.value.ratio_width != null || dimensions.value.ratio_height != null)
const tagCount = computed(() => model.value.and_tags.length + model.value.or_tags.length + model.value.not_tags.length)
const tagSummary = computed(() => describeSearchFilters({ ...model.value, dimensions: {} }, props.tags))
const sizeLabel = computed(() => hasSize.value ? `${dimensions.value.width ?? '—'} × ${dimensions.value.height ?? '—'}` : '不限尺寸')
const ratioLabel = computed(() => hasRatio.value ? `${dimensions.value.ratio_width ?? '—'}:${dimensions.value.ratio_height ?? '—'}` : '不限比例')
const hasFilters = computed(() => hasSize.value || hasRatio.value || tagCount.value > 0)
async function apply() {
  sizeOpen.value = ratioOpen.value = tagsOpen.value = false
  await nextTick()
  emit('apply')
}
function selectSize(width?: number, height?: number) {
  model.value.dimensions = { ...dimensions.value, width, height }
  void apply()
}
function selectRatio(width?: number, height?: number) {
  model.value.dimensions = { ...dimensions.value, ratio_width: width, ratio_height: height }
  void apply()
}
function applySize() {
  if (validSize.value) selectSize(sizeDraft.value.width ?? undefined, sizeDraft.value.height ?? undefined)
}
function applyRatio() {
  if (validRatio.value) selectRatio(ratioDraft.value.width ?? undefined, ratioDraft.value.height ?? undefined)
}
function applyTags() {
  model.value = { ...model.value, and_tags: [...tagsDraft.value.and_tags],
    or_tags: [...tagsDraft.value.or_tags], not_tags: [...tagsDraft.value.not_tags] }
  void apply()
}
function reset() { model.value = emptySearchFilters(); void apply() }
</script>
<template>
  <div v-if="panel" class="panel-filters">
    <fieldset :disabled="loading">
      <section>
        <div class="popover-heading"><strong>指定尺寸</strong><button type="button" class="reset-link" @click="selectSize()">不限</button></div>
        <select class="panel-preset" aria-label="分辨率预设" :value="hasSize ? `${dimensions.width}x${dimensions.height}` : ''" @change="event => { const [w,h] = (event.target as HTMLSelectElement).value.split('x').map(Number); selectSize(w || undefined,h || undefined) }">
          <option value="">不限尺寸</option>
          <option v-if="hasSize && !sizePresets.some(p => p.width === dimensions.width && p.height === dimensions.height)" :value="`${dimensions.width}x${dimensions.height}`">自定义 {{ sizeLabel }}</option>
          <option v-for="preset in sizePresets" :key="preset.ratio" :value="`${preset.width}x${preset.height}`">{{ preset.width }} × {{ preset.height }} · {{ preset.ratio }}</option>
        </select>
        <form class="panel-custom" @submit.prevent="applySize"><div class="input-pair">
          <a-input-number size="small" v-model:value="sizeDraft.width" :disabled="loading" :min="1" :max="1000000" placeholder="宽" aria-label="图片宽度" /><span>×</span>
          <a-input-number size="small" v-model:value="sizeDraft.height" :disabled="loading" :min="1" :max="1000000" placeholder="高" aria-label="图片高度" />
          <a-button size="small" html-type="submit" :disabled="loading || !validSize">应用</a-button>
        </div><p v-if="!validSize" class="filter-error">请填写完整的宽和高</p></form>
      </section>
      <section>
        <div class="popover-heading"><strong>宽高比例</strong><button type="button" class="reset-link" @click="selectRatio()">不限</button></div>
        <div class="preset-grid ratios"><button v-for="preset in sizePresets" :key="preset.ratio" type="button" :class="{ selected: dimensions.ratio_width === preset.rw && dimensions.ratio_height === preset.rh }" @click="selectRatio(preset.rw,preset.rh)">{{ preset.ratio }}</button></div>
        <form class="panel-custom" @submit.prevent="applyRatio"><div class="input-pair">
          <a-input-number size="small" v-model:value="ratioDraft.width" :disabled="loading" :min="1" :max="1000000" placeholder="宽" aria-label="比例宽" /><span>:</span>
          <a-input-number size="small" v-model:value="ratioDraft.height" :disabled="loading" :min="1" :max="1000000" placeholder="高" aria-label="比例高" />
          <a-button size="small" html-type="submit" :disabled="loading || !validRatio">应用</a-button>
        </div><p v-if="!validRatio" class="filter-error">请填写完整的比例</p></form>
      </section>
      <section>
        <div class="popover-heading"><strong>标签</strong><button type="button" class="reset-link" @click="tagsDraft = emptySearchFilters(); applyTags()">清空</button></div>
        <div class="tag-field"><label>全部包含</label><SearchSelect :conv="conv" :disabled="loading" mode="multiple" :options="selectableTags" v-model:value="tagsDraft.and_tags" placeholder="选择标签" /></div>
        <div class="tag-field"><label>任意包含</label><SearchSelect :conv="conv" :disabled="loading" mode="multiple" :options="selectableTags" v-model:value="tagsDraft.or_tags" placeholder="选择标签" /></div>
        <div class="tag-field"><label>排除</label><SearchSelect :conv="conv" :disabled="loading" mode="multiple" :options="selectableTags" v-model:value="tagsDraft.not_tags" placeholder="选择标签" /></div>
        <a-button size="small" :disabled="loading" @click="applyTags">应用标签</a-button>
      </section>
      <a-button size="small" type="text" :disabled="loading || !hasFilters" @click="reset">重置全部筛选</a-button>
    </fieldset>
  </div>
  <div v-else class="media-search-filters" role="group" aria-label="筛选媒体">
    <span class="filter-label">筛选</span>
    <a-popover v-model:open="sizeOpen" trigger="click" placement="bottomLeft">
      <a-button class="filter-button" :class="{ active: hasSize }" :disabled="loading" :aria-expanded="sizeOpen" :title="`指定尺寸：${sizeLabel}`">
        {{ sizeLabel }} <DownOutlined />
      </a-button>
      <template #content>
        <div class="filter-popover">
          <div class="popover-heading"><strong>指定尺寸</strong><a-button type="link" size="small" @click="selectSize()">不限</a-button></div>
          <div class="preset-grid sizes">
            <button v-for="preset in sizePresets" :key="preset.ratio" type="button"
              :class="{ selected: dimensions.width === preset.width && dimensions.height === preset.height }"
              @click="selectSize(preset.width, preset.height)">
              {{ preset.width }} × {{ preset.height }} <small>{{ preset.ratio }}</small>
            </button>
          </div>
          <form class="custom-filter" @submit.prevent="applySize">
            <label>自定义尺寸</label>
            <div class="input-pair">
              <a-input-number v-model:value="sizeDraft.width" :min="1" :max="1000000" placeholder="宽度" aria-label="图片宽度" />
              <span>×</span>
              <a-input-number v-model:value="sizeDraft.height" :min="1" :max="1000000" placeholder="高度" aria-label="图片高度" />
              <span>px</span>
            </div>
            <p v-if="!validSize" class="filter-error" role="alert">请填写完整的宽和高，使用正整数。</p>
            <div class="popover-footer"><span>按像素尺寸精确匹配</span><a-button type="primary" html-type="submit" :disabled="!validSize">应用</a-button></div>
          </form>
        </div>
      </template>
    </a-popover>
    <a-popover v-model:open="ratioOpen" trigger="click" placement="bottomLeft">
      <a-button class="filter-button" :class="{ active: hasRatio }" :disabled="loading" :aria-expanded="ratioOpen" :title="`宽高比例：${ratioLabel}`">
        {{ ratioLabel }} <DownOutlined />
      </a-button>
      <template #content>
        <div class="filter-popover">
          <div class="popover-heading"><strong>宽高比例</strong><a-button type="link" size="small" @click="selectRatio()">不限</a-button></div>
          <div class="preset-grid ratios">
            <button v-for="preset in sizePresets" :key="preset.ratio" type="button"
              :class="{ selected: dimensions.ratio_width === preset.rw && dimensions.ratio_height === preset.rh }"
              @click="selectRatio(preset.rw, preset.rh)">{{ preset.ratio }}</button>
          </div>
          <form class="custom-filter" @submit.prevent="applyRatio">
            <label>自定义比例</label>
            <div class="input-pair">
              <a-input-number v-model:value="ratioDraft.width" :min="1" :max="1000000" placeholder="宽" aria-label="比例宽" />
              <span>:</span>
              <a-input-number v-model:value="ratioDraft.height" :min="1" :max="1000000" placeholder="高" aria-label="比例高" />
            </div>
            <p v-if="!validRatio" class="filter-error" role="alert">请填写完整的比例，使用正整数。</p>
            <div class="popover-footer"><span>按宽:高匹配，区分横竖图</span><a-button type="primary" html-type="submit" :disabled="!validRatio">应用</a-button></div>
          </form>
        </div>
      </template>
    </a-popover>
    <a-popover v-model:open="tagsOpen" trigger="click" placement="bottomLeft">
      <a-button class="filter-button" :class="{ active: tagCount }" :disabled="loading" :aria-expanded="tagsOpen" :title="tagSummary || '按标签筛选'">
        标签<span v-if="tagCount"> · {{ tagCount }}</span> <DownOutlined />
      </a-button>
      <template #content>
        <div class="filter-popover tag-popover">
          <div class="popover-heading"><strong>标签筛选</strong><a-button type="link" size="small" @click="tagsDraft = emptySearchFilters()">清空</a-button></div>
          <div class="tag-field"><label>全部包含</label><SearchSelect :conv="conv" mode="multiple" :options="selectableTags" v-model:value="tagsDraft.and_tags" placeholder="选择需要全部包含的标签" /></div>
          <div class="tag-field"><label>任意包含</label><SearchSelect :conv="conv" mode="multiple" :options="selectableTags" v-model:value="tagsDraft.or_tags" placeholder="选择至少包含一个的标签" /></div>
          <div class="tag-field"><label>排除标签</label><SearchSelect :conv="conv" mode="multiple" :options="selectableTags" v-model:value="tagsDraft.not_tags" placeholder="选择要排除的标签" /></div>
          <div class="popover-footer"><span>在设置 → 标签配置中管理</span><a-button type="primary" @click="applyTags">应用筛选</a-button></div>
        </div>
      </template>
    </a-popover>
    <a-button v-if="hasFilters" type="text" size="small" :disabled="loading" @click="reset">重置</a-button>
  </div>
</template>
<style scoped lang="scss">
.media-search-filters{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;}
.filter-label{font-size:12px;color:var(--zp-secondary);margin-right:2px;}
.filter-button{height:30px;font-size:12px;padding:0 10px;border-radius:6px;}
.filter-button .anticon{font-size:10px;margin-left:6px;color:var(--zp-secondary);}
.filter-button.active{color:var(--primary-color);border-color:var(--primary-color);background:var(--zp-secondary-background);}
.filter-popover{width:min(340px,calc(100vw - 48px));max-height:min(520px,70vh);overflow:auto;color:var(--zp-primary);}
.popover-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
.preset-grid{display:grid;gap:6px;}.sizes{grid-template-columns:1fr 1fr;}.ratios{grid-template-columns:repeat(4,1fr);}
.preset-grid button{border:1px solid var(--zp-border);border-radius:5px;background:var(--zp-primary-background);color:inherit;cursor:pointer;min-height:32px;padding:6px;font-size:12px;}
.preset-grid button:hover,.preset-grid button.selected{border-color:var(--primary-color);color:var(--primary-color);}
.preset-grid small{color:var(--zp-secondary);font-size:10px;margin-left:4px;}
.custom-filter{border-top:1px solid var(--zp-border);margin-top:12px;padding-top:12px;}
.custom-filter>label,.tag-field>label{display:block;font-size:12px;margin-bottom:6px;color:var(--zp-secondary);}
.input-pair{display:flex;align-items:center;gap:8px;}.input-pair .ant-input-number{min-width:0;flex:1;}
.popover-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;}
.popover-footer>span{color:var(--zp-secondary);font-size:11px;line-height:1.5;}.popover-footer .ant-btn{flex-shrink:0;}
.tag-field{margin:12px 0;}.tag-field>:last-child{width:100%;min-width:0;}
.filter-error{font-size:12px;color:#d4380d;margin:8px 0 0;}
</style>

<style scoped>
.panel-filters fieldset{border:0;margin:0;padding:0;min-width:0;}
.panel-filters section{margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--zp-border);}
.panel-filters .popover-heading{font-size:12px;margin-bottom:8px;}
.panel-preset{height:30px;width:100%;padding:0 8px;border:1px solid var(--zp-border);border-radius:5px;background:var(--zp-primary-background);color:var(--zp-primary);font-size:12px;}
.reset-link{border:0;background:none;color:var(--primary-color);cursor:pointer;font-size:11px;padding:0;}
.panel-custom{margin-top:8px;}.panel-filters .input-pair{gap:6px;}.panel-filters .input-pair .ant-btn{flex-shrink:0;}
.panel-filters .tag-field{margin:8px 0;}.panel-filters .tag-field>label{font-size:11px;margin-bottom:4px;}
</style>
