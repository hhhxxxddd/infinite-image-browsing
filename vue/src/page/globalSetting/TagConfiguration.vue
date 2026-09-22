<script setup lang="ts">
import { tagLabel } from '@/util/tagLabel'
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { addCustomTag, getDbBasicInfo, removeCustomTag, updateTag, type Tag } from '@/api/db'
import { useGlobalStore } from '@/store/useGlobalStore'
import { useTagStore } from '@/store/useTagStore'
import ColorPicker from '@/components/ColorPicker.vue'
import AutoTagSettings from './AutoTagSettings.vue'

const global = useGlobalStore()
const tagStore = useTagStore()
const name = ref('')
const busy = ref(false)
const tags = computed(() => global.conf?.all_custom_tags ?? [])
const readonly = computed(() => !!global.conf?.is_readonly)
const usesRule = (tag: Tag) => !!global.conf?.app_fe_setting?.auto_tag_rules?.some((rule: { tag: string }) => rule.tag === tag.name)
async function refresh() {
  const info = await getDbBasicInfo()
  if (global.conf) global.conf.all_custom_tags = info.tags.filter(tag => tag.type === 'custom')
  tagStore.tagMap.clear()
}
async function add() {
  const value = name.value.trim()
  if (!value || busy.value || readonly.value) return
  if (tags.value.some(tag => tag.name === value || tagLabel(tag) === value)) { message.warning('这个标签已经存在'); return }
  busy.value = true
  try {
    await addCustomTag({ tag_name: value })
    await refresh()
    name.value = ''
    message.success('标签已创建，可在搜图时选择或给图片打标')
  } finally { busy.value = false }
}
async function remove(tag: Tag) {
  if (readonly.value || tag.name === 'like' || usesRule(tag)) return
  busy.value = true
  try { await removeCustomTag({ tag_id: tag.id }); await refresh(); message.success('标签已删除') }
  finally { busy.value = false }
}
async function changeColor(tag: Tag, color: string) {
  if (readonly.value) return
  await updateTag({ ...tag, color })
  tag.color = color
  tagStore.notifyCacheUpdate(tag)
}
onMounted(refresh)
</script>

<template>
  <div class="tag-configuration">
    <p class="description">在这里配置标签和自动打标规则。查找图片时，请在媒体库的筛选栏中选择标签；尺寸和比例是独立的筛选条件。</p>
    <h3>自定义标签</h3>
    <form class="create-tag" @submit.prevent="add">
      <a-input v-model:value="name" placeholder="输入新标签名称，例如：风景、待整理" aria-label="新标签名称" :disabled="readonly || busy" :maxlength="40" allow-clear />
      <a-button type="primary" html-type="submit" :disabled="readonly || !name.trim()" :loading="busy">新增标签</a-button>
    </form>
    <div class="configured-tags">
      <div v-for="tag in tags" :key="tag.id" class="configured-tag">
        <div v-if="!readonly" class="tag-color" :title="`设置 ${tagLabel(tag)} 的颜色`">
          <ColorPicker :pure-color="tagStore.getColor(tag)" @update:pure-color="changeColor(tag, $event)" />
        </div>
        <span class="tag-name">{{ tagLabel(tag) }}</span>
        <span v-if="tag.name === 'like'" class="tag-note">内置收藏标签</span>
        <span v-else-if="usesRule(tag)" class="tag-note">用于自动打标规则</span>
        <a-popconfirm v-if="tag.name !== 'like'" title="删除此标签及其图片关联？图片文件会保留。" :disabled="readonly || busy || usesRule(tag)" @confirm="remove(tag)">
          <a-button type="text" danger :disabled="readonly || busy || usesRule(tag)" :title="usesRule(tag) ? '请先移除使用此标签的自动打标规则' : '删除标签'">删除</a-button>
        </a-popconfirm>
      </div>
    </div>
    <h3 class="rules-heading">自动打标规则</h3>
    <AutoTagSettings />
  </div>
</template>

<style scoped>
.description{color:var(--zp-secondary);line-height:1.7;}
.create-tag{display:flex;gap:8px;max-width:600px;margin:16px 0;}
.create-tag .ant-input-affix-wrapper{min-width:0;flex:1;}
.configured-tags{display:flex;flex-wrap:wrap;gap:8px;}
.configured-tag{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--zp-border);border-radius:8px;max-width:100%;}
.tag-color{width:24px;height:24px;flex-shrink:0;overflow:hidden;border-radius:5px;}
.tag-name{overflow-wrap:anywhere;}.tag-note{font-size:12px;color:var(--zp-secondary);}
.rules-heading{margin-top:32px;}
@media(max-width:550px){.configured-tag{flex-wrap:wrap;}.tag-note{flex-basis:100%;}}
</style>
