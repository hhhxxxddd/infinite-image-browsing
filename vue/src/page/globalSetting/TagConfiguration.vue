<script setup lang="ts">
import { tagLabel } from '@/util/tagLabel'
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { addCustomTag, createTagGroup, deleteTagGroup, getDbBasicInfo, getTagGroups, removeCustomTag, renameCustomTag, renameTagGroup, updateTag, type Tag } from '@/api/db'
import { useGlobalStore, type Shortcut } from '@/store/useGlobalStore'
import { useTagStore } from '@/store/useTagStore'
import ColorPicker from '@/components/ColorPicker.vue'
import AutoTagSettings from './AutoTagSettings.vue'

const global = useGlobalStore()
const tagStore = useTagStore()
const newTagNames = ref<Record<string, string>>({})
const groupName = ref('')
const groupNames = ref<string[]>([])
const editingGroup = ref('')
const editingGroupName = ref('')
const draggedTagId = ref<Tag['id'] | null>(null)
const dropTarget = ref<string | null>(null)
const busy = ref(false)
const editingId = ref<Tag['id'] | null>(null)
const editingName = ref('')
const tagRename = ref<{ from: string; to: string } | null>(null)
const tags = computed(() => global.conf?.all_custom_tags ?? [])
const groupedTags = computed(() => [
  { name: '', tags: tags.value.filter(tag => !tag.group_name) },
  ...groupNames.value.map(group => ({ name: group, tags: tags.value.filter(tag => tag.group_name === group) }))
])
const readonly = computed(() => !!global.conf?.is_readonly)
const usesRule = (tag: Tag) => !!global.conf?.app_fe_setting?.auto_tag_rules?.some((rule: { tag: string }) => rule.tag === tag.name)
async function refresh() {
  const [info, groups] = await Promise.all([getDbBasicInfo(false), getTagGroups()])
  if (global.conf) global.conf.all_custom_tags = info.tags.filter(tag => tag.type === 'custom')
  groupNames.value = groups
  tagStore.tagMap.clear()
}
function showGroupError(error: any) { message.error(error.response?.data?.detail || '保存分组失败，请重试') }
async function addGroup() {
  const value = groupName.value.trim()
  if (!value || busy.value || readonly.value) return
  if (value === '未分组') { message.warning('“未分组”是固定分组'); return }
  if (groupNames.value.includes(value)) { message.warning('这个分组已经存在'); return }
  busy.value = true
  try { groupNames.value = await createTagGroup(value); groupName.value = '' }
  catch (error) { showGroupError(error) }
  finally { busy.value = false }
}
async function saveGroupName(oldName: string) {
  const value = editingGroupName.value.trim()
  if (!value || busy.value || readonly.value) return
  if (value === '未分组') { message.warning('“未分组”是固定分组'); return }
  if (value === oldName) { editingGroup.value = ''; return }
  busy.value = true
  try { groupNames.value = await renameTagGroup(oldName, value); editingGroup.value = ''; await refresh() }
  catch (error) { showGroupError(error) }
  finally { busy.value = false }
}
async function removeGroup(group: string) {
  if (busy.value || readonly.value) return
  busy.value = true
  try { groupNames.value = await deleteTagGroup(group); await refresh() }
  catch (error) { showGroupError(error) }
  finally { busy.value = false }
}
async function moveTag(tag: Tag, group_name: string) {
  if (readonly.value) return
  try {
    await updateTag({ id: tag.id, group_name })
    tag.group_name = group_name
  } catch (error) { showGroupError(error) }
}
async function add(group: string) {
  const value = (newTagNames.value[group] ?? '').trim()
  if (!value || busy.value || readonly.value) return
  if (tags.value.some(tag => tag.name === value || tagLabel(tag) === value)) { message.warning('这个标签已经存在'); return }
  busy.value = true
  try {
    await addCustomTag({ tag_name: value, group_name: group })
    await refresh()
    newTagNames.value[group] = ''
    message.success('标签已创建，可在搜图时选择或给图片打标')
  } catch (error: any) { message.error(error.response?.data?.detail || '新增标签失败，请重试') }
  finally { busy.value = false }
}
function startDrag(event: DragEvent, tag: Tag) {
  if (readonly.value) { event.preventDefault(); return }
  draggedTagId.value = tag.id
  event.dataTransfer?.setData('application/x-iib-tag-id', String(tag.id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function endDrag() { draggedTagId.value = null; dropTarget.value = null }
function allowDrop(event: DragEvent, group: string) {
  if (draggedTagId.value === null) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTarget.value = group
}
async function dropTag(event: DragEvent, group: string) {
  if (draggedTagId.value === null) return
  event.preventDefault()
  const id = event.dataTransfer?.getData('application/x-iib-tag-id') || String(draggedTagId.value ?? '')
  const tag = tags.value.find(tag => String(tag.id) === id)
  endDrag()
  if (tag && tag.group_name !== group) await moveTag(tag, group)
}
async function remove(tag: Tag) {
  if (readonly.value || tag.name === 'like' || usesRule(tag)) return
  busy.value = true
  try { await removeCustomTag({ tag_id: tag.id }); await refresh(); message.success('标签已删除') }
  finally { busy.value = false }
}
async function changeColor(tag: Tag, color: string) {
  if (readonly.value) return
  await updateTag({ id: tag.id, color })
  tag.color = color
  tagStore.notifyCacheUpdate(tag)
}
function startRename(tag: Tag) {
  editingId.value = tag.id
  editingName.value = tag.name
}
function cancelRename() {
  editingId.value = null
  editingName.value = ''
}
function handleRenameKeydown(event: KeyboardEvent, tag: Tag) {
  if (event.key === 'Enter') { event.preventDefault(); void saveRename(tag) }
  else if (event.key === 'Escape') { event.preventDefault(); cancelRename() }
}
async function saveRename(tag: Tag) {
  if (readonly.value || busy.value || tag.name === 'like') return
  const value = editingName.value.trim()
  if (!value) { message.warning('请输入标签名称'); return }
  if (value === tag.name) { cancelRename(); return }
  if (tags.value.some(other => other.id !== tag.id && (other.name === value || tagLabel(other) === value))) {
    message.warning('这个标签已经存在')
    return
  }
  busy.value = true
  try {
    const oldName = tag.name
    const renamed = await renameCustomTag(tag.id, value)
    const rules = global.conf?.app_fe_setting?.auto_tag_rules
    if (Array.isArray(rules)) {
      global.conf!.app_fe_setting.auto_tag_rules = rules.map(rule =>
        rule.tag === oldName ? { ...rule, tag: renamed.name } : rule)
    }
    const oldKey = `toggle_tag_${oldName}` as keyof Shortcut
    const newKey = `toggle_tag_${renamed.name}` as keyof Shortcut
    if (oldKey in global.shortcut) {
      global.shortcut[newKey] = global.shortcut[oldKey]
      delete global.shortcut[oldKey]
    }
    tag.name = renamed.name
    tagRename.value = { from: oldName, to: renamed.name }
    cancelRename()
    try { await refresh() } catch { tagStore.tagMap.clear() }
    message.success('标签已改名，图片标签和自动打标规则保持不变')
  } catch (error: any) {
    message.error(error.response?.data?.detail || '标签改名失败，请重试')
  } finally { busy.value = false }
}
onMounted(refresh)
</script>

<template>
  <div class="tag-configuration">
    <p class="description">在这里配置标签和自动打标规则。查找图片时，请在媒体库的筛选栏中选择标签；尺寸和比例是独立的筛选条件。</p>
    <h3>标签分组</h3>
    <p class="description">在分组内添加标签，拖动标签卡片可调整分组。筛选和自动打标规则会按分组展示；删除分组会把其中标签移回“未分组”。</p>
    <form class="create-tag" @submit.prevent="addGroup">
      <a-input v-model:value="groupName" placeholder="输入分组名称，例如：主题、用途" aria-label="新分组名称" :disabled="readonly || busy" :maxlength="40" allow-clear />
      <a-button html-type="submit" :disabled="readonly || !groupName.trim()" :loading="busy">新增分组</a-button>
    </form>
    <section v-for="group in groupedTags" :key="group.name" class="tag-group-section" :class="{ 'drop-target': draggedTagId !== null && dropTarget === group.name }" @dragover="allowDrop($event, group.name)" @drop="dropTag($event, group.name)">
      <div class="tag-group-heading">
        <template v-if="group.name">
          <a-input v-if="editingGroup === group.name" v-model:value="editingGroupName" class="group-rename" :maxlength="40" aria-label="修改分组名称" @keydown.enter.prevent="saveGroupName(group.name)" @keydown.esc.prevent="editingGroup = ''" />
          <h4 v-else>{{ group.name }}</h4>
          <a-button v-if="editingGroup === group.name" size="small" type="primary" :disabled="busy" @click="saveGroupName(group.name)">保存</a-button>
          <a-button v-if="editingGroup === group.name" size="small" @click="editingGroup = ''">取消</a-button>
          <a-button v-else size="small" type="text" :disabled="readonly || busy" @click="editingGroup = group.name; editingGroupName = group.name">改名</a-button>
          <a-popconfirm title="删除此分组？其中的标签会移到未分组。" :disabled="readonly || busy" @confirm="removeGroup(group.name)">
            <a-button size="small" type="text" danger :disabled="readonly || busy">删除分组</a-button>
          </a-popconfirm>
        </template>
        <h4 v-else>未分组</h4>
        <small>{{ group.tags.length }} 个标签</small>
      </div>
      <div class="configured-tags">
      <div v-for="tag in group.tags" :key="tag.id" class="configured-tag" :class="{ dragging: draggedTagId === tag.id }" :draggable="!readonly" :aria-label="`拖动 ${tagLabel(tag)} 到其他分组`" @dragstart="startDrag($event, tag)" @dragend="endDrag">
        <div v-if="!readonly" class="tag-color" :title="`设置 ${tagLabel(tag)} 的颜色`">
          <ColorPicker :pure-color="tagStore.getColor(tag)" @update:pure-color="changeColor(tag, $event)" />
        </div>
        <a-input v-if="editingId === tag.id" v-model:value="editingName" class="rename-input" :maxlength="40" :aria-label="`修改标签名称：${tagLabel(tag)}`" :disabled="busy" @keydown="handleRenameKeydown($event, tag)" />
        <span v-else class="tag-name">{{ tagLabel(tag) }}</span>
        <span v-if="tag.name === 'like'" class="tag-note">内置收藏标签</span>
        <span v-else-if="usesRule(tag)" class="tag-note">用于自动打标规则</span>
        <a-dropdown v-if="groupNames.length" trigger="click">
          <a-button size="small" type="text" :disabled="readonly || busy">移动到</a-button>
          <template #overlay><a-menu>
            <a-menu-item v-if="group.name" @click="moveTag(tag, '')">未分组</a-menu-item>
            <a-menu-item v-for="option in groupNames.filter(option => option !== group.name)" :key="option" @click="moveTag(tag, option)">{{ option }}</a-menu-item>
          </a-menu></template>
        </a-dropdown>
        <template v-if="editingId === tag.id">
          <a-button size="small" type="primary" :loading="busy" @click="saveRename(tag)">保存</a-button>
          <a-button size="small" :disabled="busy" @click="cancelRename">取消</a-button>
        </template>
        <a-button v-else-if="tag.name !== 'like'" type="text" :disabled="readonly || busy" :aria-label="`修改标签名称：${tagLabel(tag)}`" @click="startRename(tag)">改名</a-button>
        <a-popconfirm v-if="tag.name !== 'like'" title="删除此标签及其图片关联？图片文件会保留。" :disabled="readonly || busy || usesRule(tag)" @confirm="remove(tag)">
          <a-button type="text" danger :disabled="readonly || busy || usesRule(tag)" :title="usesRule(tag) ? '请先移除使用此标签的自动打标规则' : '删除标签'">删除</a-button>
        </a-popconfirm>
      </div>
      </div>
      <form class="create-tag group-create-tag" @submit.prevent="add(group.name)">
        <a-input v-model:value="newTagNames[group.name]" :placeholder="`在${group.name || '未分组'}中添加标签`" :aria-label="`在${group.name || '未分组'}中添加标签`" :disabled="readonly || busy" :maxlength="40" allow-clear />
        <a-button html-type="submit" :disabled="readonly || !newTagNames[group.name]?.trim()" :loading="busy">添加标签</a-button>
      </form>
    </section>
    <h3 class="rules-heading">自动打标规则</h3>
    <AutoTagSettings :tag-rename="tagRename" />
  </div>
</template>

<style scoped>
.description{color:var(--zp-secondary);line-height:1.7;}
.create-tag{display:flex;gap:8px;max-width:600px;margin:16px 0;}
.create-tag .ant-input-affix-wrapper{min-width:0;flex:1;}
.configured-tags{display:flex;flex-wrap:wrap;gap:8px;}
.configured-tag{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--zp-border);border-radius:8px;max-width:100%;}
.configured-tag[draggable="true"]{cursor:grab;}.configured-tag.dragging{opacity:.5;}
.tag-color{width:24px;height:24px;flex-shrink:0;border-radius:5px;}
.tag-name{overflow-wrap:anywhere;}.tag-note{font-size:12px;color:var(--zp-secondary);}
.rename-input{width:180px;max-width:100%;}
.tag-group-section{border:1px solid var(--zp-border);border-radius:8px;padding:12px;margin:12px 0;transition:border-color .15s,background .15s;}
.tag-group-section.drop-target{border-color:var(--primary-color);background:var(--zp-secondary-background);}
.tag-group-heading{display:flex;align-items:center;gap:8px;margin-bottom:10px;min-height:28px;}
.tag-group-heading h4{font-size:14px;margin:0 8px 0 0;}
.tag-group-heading small{margin-left:auto;color:var(--zp-secondary);}
.group-rename{max-width:180px;}
.group-create-tag{margin:12px 0 0;max-width:520px;}
.rules-heading{margin-top:32px;}
@media(max-width:550px){.configured-tag{flex-wrap:wrap;}.tag-note{flex-basis:100%;}}
</style>
