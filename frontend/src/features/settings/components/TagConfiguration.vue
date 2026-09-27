<script setup lang="ts">
import { getErrorMessage } from '@/shared/lib/errorMessage'

import { tagLabel } from '@/features/media-library/public'
import { computed, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SearchOutlined
} from '@ant-design/icons-vue'
import {
  addCustomTag,
  createTagGroup,
  deleteTagGroup,
  getDbBasicInfo,
  getTagGroups,
  removeCustomTag,
  renameCustomTag,
  renameTagGroup,
  updateTag,
  type Tag
} from '@/features/media-library/public'
import { useApplicationStore } from '@/features/application/public'
import { useTagStore } from '@/features/media-library/public'
import ColorPicker from '@/shared/ui/ColorPicker.vue'
import AutoTagSettings from './AutoTagSettings.vue'
import SettingsGroup from './SettingsGroup.vue'
import './settingsControls.css'
import { filterTagGroups, groupTags, paginateTags } from '../model/tagListView'

const global = useApplicationStore()
const tagStore = useTagStore()
const newTagNames = ref<Record<string, string>>({})
const groupName = ref('')
const showCreateGroup = ref(false)
const groupNames = ref<string[]>([])
const editingGroup = ref('')
const editingGroupName = ref('')
function beginGroupRename(name: string) {
  editingGroup.value = name
  editingGroupName.value = name
}
const draggedTagId = ref<Tag['id'] | null>(null)
const dropTarget = ref<string | null>(null)
const busy = ref(false)
const editingId = ref<Tag['id'] | null>(null)
const editingName = ref('')
const tagRename = ref<{ from: string; to: string } | null>(null)
const tagSearch = ref('')
const activeGroup = ref<string | null>(null)
const groupsLoaded = ref(false)
const visibleGroupCount = ref(12)
const tagPages = ref<Record<string, number>>({})
const TAG_PAGE_SIZE = 40
const GROUP_PAGE_SIZE = 12
const tags = computed(() => global.conf?.all_custom_tags ?? [])
const groupedTags = computed(() => groupTags(tags.value, groupNames.value))
const filteredGroups = computed(() => filterTagGroups(groupedTags.value, tagSearch.value, tagLabel))
const visibleGroups = computed(() => filteredGroups.value.slice(0, visibleGroupCount.value))
const matchCount = computed(() =>
  filteredGroups.value.reduce((count, group) => count + group.tags.length, 0)
)
function isGroupOpen(name: string) {
  return activeGroup.value === name
}
function toggleGroup(name: string) {
  activeGroup.value = activeGroup.value === name ? null : name
}
function pageCount(total: number) {
  return Math.max(1, Math.ceil(total / TAG_PAGE_SIZE))
}
function pageForGroup(name: string, total: number) {
  return Math.min(tagPages.value[name] ?? 1, pageCount(total))
}
function setTagPage(name: string, page: number) {
  tagPages.value = { ...tagPages.value, [name]: page }
}
watch(tagSearch, () => {
  visibleGroupCount.value = GROUP_PAGE_SIZE
  tagPages.value = {}
  const activeIndex = filteredGroups.value.findIndex((group) => group.name === activeGroup.value)
  if (activeIndex < 0 || activeIndex >= GROUP_PAGE_SIZE) {
    activeGroup.value =
      filteredGroups.value.find((group) => group.tags.length)?.name ??
      filteredGroups.value[0]?.name ??
      null
  }
})
watch(
  [filteredGroups, groupsLoaded],
  ([groups, loaded]) => {
    if (!loaded) return
    if (!groups.some((group) => group.name === activeGroup.value)) {
      activeGroup.value = groups.find((group) => group.tags.length)?.name ?? groups[0]?.name ?? null
    }
  },
  { immediate: true }
)
const readonly = computed(() => !!global.conf?.is_readonly)
const ruleTagNames = computed(
  () =>
    new Set<string>(
      (global.conf?.app_fe_setting?.auto_tag_rules ?? []).map((rule: { tag: string }) => rule.tag)
    )
)
const usesRule = (tag: Tag) => ruleTagNames.value.has(tag.name)
async function refresh() {
  const [info, groups] = await Promise.all([getDbBasicInfo(false), getTagGroups()])
  if (global.conf) global.conf.all_custom_tags = info.tags.filter((tag) => tag.type === 'custom')
  groupNames.value = groups
  groupsLoaded.value = true
  tagStore.tagMap.clear()
}
function showGroupError(error: unknown) {
  message.error(getErrorMessage(error, '保存分组失败，请重试'))
}
async function addGroup() {
  const value = groupName.value.trim()
  if (!value || busy.value || readonly.value) return
  if (value === '未分组') {
    message.warning('“未分组”是固定分组')
    return
  }
  if (groupNames.value.includes(value)) {
    message.warning('这个分组已经存在')
    return
  }
  busy.value = true
  try {
    groupNames.value = await createTagGroup(value)
    groupName.value = ''
    showCreateGroup.value = false
    tagSearch.value = value
    activeGroup.value = value
  } catch (error) {
    showGroupError(error)
  } finally {
    busy.value = false
  }
}
async function saveGroupName(oldName: string) {
  const value = editingGroupName.value.trim()
  if (!value || busy.value || readonly.value) return
  if (value === '未分组') {
    message.warning('“未分组”是固定分组')
    return
  }
  if (value === oldName) {
    editingGroup.value = ''
    return
  }
  busy.value = true
  try {
    groupNames.value = await renameTagGroup(oldName, value)
    editingGroup.value = ''
    await refresh()
    if (tagSearch.value.trim() === oldName) tagSearch.value = value
    activeGroup.value = value
  } catch (error) {
    showGroupError(error)
  } finally {
    busy.value = false
  }
}
async function removeGroup(group: string) {
  if (busy.value || readonly.value) return
  busy.value = true
  try {
    groupNames.value = await deleteTagGroup(group)
    await refresh()
    if (tagSearch.value.trim() === group) tagSearch.value = ''
  } catch (error) {
    showGroupError(error)
  } finally {
    busy.value = false
  }
}
async function moveTag(tag: Tag, group_name: string) {
  if (readonly.value) return
  try {
    await updateTag({ id: tag.id, group_name })
    tag.group_name = group_name
  } catch (error) {
    showGroupError(error)
  }
}
async function add(group: string) {
  const value = (newTagNames.value[group] ?? '').trim()
  if (!value || busy.value || readonly.value) return
  if (tags.value.some((tag) => tag.name === value || tagLabel(tag) === value)) {
    message.warning('这个标签已经存在')
    return
  }
  busy.value = true
  try {
    await addCustomTag({ tag_name: value, group_name: group })
    await refresh()
    newTagNames.value[group] = ''
    tagSearch.value = value
    activeGroup.value = group
    message.success('标签已创建，可在搜图时选择或给图片打标')
  } catch (error) {
    message.error(getErrorMessage(error, '新增标签失败，请重试'))
  } finally {
    busy.value = false
  }
}
function startDrag(event: DragEvent, tag: Tag) {
  if (readonly.value) {
    event.preventDefault()
    return
  }
  draggedTagId.value = tag.id
  event.dataTransfer?.setData('application/x-omnigallery-tag-id', String(tag.id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function endDrag() {
  draggedTagId.value = null
  dropTarget.value = null
}
function allowDrop(event: DragEvent, group: string) {
  if (draggedTagId.value === null) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTarget.value = group
}
async function dropTag(event: DragEvent, group: string) {
  if (draggedTagId.value === null) return
  event.preventDefault()
  const id =
    event.dataTransfer?.getData('application/x-omnigallery-tag-id') ||
    String(draggedTagId.value ?? '')
  const tag = tags.value.find((tag) => String(tag.id) === id)
  endDrag()
  if (tag && tag.group_name !== group) await moveTag(tag, group)
}
async function remove(tag: Tag) {
  if (readonly.value || tag.name === 'like' || usesRule(tag)) return
  busy.value = true
  try {
    await removeCustomTag({ tag_id: tag.id })
    await refresh()
    message.success('标签已删除')
  } finally {
    busy.value = false
  }
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
  if (event.key === 'Enter') {
    event.preventDefault()
    void saveRename(tag)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}
async function saveRename(tag: Tag) {
  if (readonly.value || busy.value || tag.name === 'like') return
  const value = editingName.value.trim()
  if (!value) {
    message.warning('请输入标签名称')
    return
  }
  if (value === tag.name) {
    cancelRename()
    return
  }
  if (
    tags.value.some(
      (other) => other.id !== tag.id && (other.name === value || tagLabel(other) === value)
    )
  ) {
    message.warning('这个标签已经存在')
    return
  }
  busy.value = true
  try {
    const oldName = tag.name
    const oldLabel = tagLabel(tag)
    const renamed = await renameCustomTag(tag.id, value)
    const settings = global.conf?.app_fe_setting
    const rules = settings?.auto_tag_rules
    if (settings && Array.isArray(rules)) {
      settings.auto_tag_rules = rules.map((rule) =>
        rule.tag === oldName ? { ...rule, tag: renamed.name } : rule
      )
    }
    tag.name = renamed.name
    tagRename.value = { from: oldName, to: renamed.name }
    cancelRename()
    try {
      await refresh()
    } catch {
      tagStore.tagMap.clear()
    }
    if (tagSearch.value.trim() === oldName || tagSearch.value.trim() === oldLabel)
      tagSearch.value = renamed.name
    message.success('标签已改名，图片标签和自动打标规则保持不变')
  } catch (error) {
    message.error(getErrorMessage(error, '标签改名失败，请重试'))
  } finally {
    busy.value = false
  }
}
onMounted(refresh)
</script>

<template>
  <div class="tag-configuration settings-stack">
    <SettingsGroup
      title="标签管理"
      help="拖动标签可更换分组，也可使用标签上的移动按钮。删除分组后，其中标签移回未分组。用于自动打标的标签需先移除对应规则才能删除。"
    >
      <template #actions>
        <a-button
          :disabled="readonly || busy"
          :aria-expanded="showCreateGroup"
          @click="showCreateGroup = !showCreateGroup"
          ><template #icon><PlusOutlined /></template>新增分组</a-button
        >
      </template>
      <div class="tag-search-row">
        <a-input
          v-model:value="tagSearch"
          aria-label="搜索标签或分组"
          placeholder="搜索标签或分组"
          allow-clear
          ><template #prefix><SearchOutlined /></template
        ></a-input>
        <span class="tag-search-count">{{
          tagSearch.trim()
            ? `找到 ${matchCount} 个标签 · ${filteredGroups.length} 个分组`
            : `共 ${tags.length} 个标签 · ${groupedTags.length} 个分组`
        }}</span>
      </div>
      <form v-if="showCreateGroup" class="create-tag" @submit.prevent="addGroup">
        <a-input
          v-model:value="groupName"
          placeholder="分组名称"
          aria-label="新分组名称"
          :disabled="readonly || busy"
          :maxlength="40"
          allow-clear
        />
        <a-button html-type="submit" :disabled="readonly || !groupName.trim()" :loading="busy"
          >创建</a-button
        >
        <a-button @click="showCreateGroup = false">取消</a-button>
      </form>
      <p v-if="tagSearch.trim() && !filteredGroups.length" class="tag-search-empty">
        没有匹配的标签或分组
      </p>
      <section
        v-for="group in visibleGroups"
        :key="group.name"
        class="tag-group-section"
        :class="{ 'drop-target': draggedTagId !== null && dropTarget === group.name }"
        @dragover="allowDrop($event, group.name)"
        @drop="dropTag($event, group.name)"
      >
        <div class="tag-group-heading">
          <button
            type="button"
            class="group-toggle"
            :aria-expanded="isGroupOpen(group.name)"
            :aria-label="`${isGroupOpen(group.name) ? '收起' : '展开'}${group.name || '未分组'}`"
            @click="toggleGroup(group.name)"
          >
            <DownOutlined :class="{ expanded: isGroupOpen(group.name) }" /><span
              v-if="!group.name || editingGroup !== group.name"
              >{{ group.name || '未分组' }}</span
            >
            <small
              >{{
                tagSearch.trim() ? `${group.tags.length} / ${group.total}` : group.total
              }}
              个标签</small
            >
          </button>
          <template v-if="group.name">
            <a-input
              v-if="editingGroup === group.name"
              v-model:value="editingGroupName"
              class="group-rename"
              :maxlength="40"
              aria-label="修改分组名称"
              @keydown.enter.prevent="saveGroupName(group.name)"
              @keydown.esc.prevent="editingGroup = ''"
            />
            <a-button
              v-if="editingGroup === group.name"
              size="small"
              type="primary"
              :disabled="busy"
              @click="saveGroupName(group.name)"
              >保存</a-button
            >
            <a-button v-if="editingGroup === group.name" size="small" @click="editingGroup = ''"
              >取消</a-button
            >
            <template v-else>
              <a-button
                size="small"
                type="text"
                class="tag-action"
                :disabled="readonly || busy"
                :aria-label="`修改分组名称：${group.name}`"
                title="修改分组名称"
                @click="beginGroupRename(group.name)"
                ><EditOutlined
              /></a-button>
              <a-popconfirm
                title="删除此分组？其中的标签会移到未分组。"
                :disabled="readonly || busy"
                @confirm="removeGroup(group.name)"
              >
                <a-button
                  size="small"
                  type="text"
                  danger
                  class="tag-action"
                  :disabled="readonly || busy"
                  :aria-label="`删除分组：${group.name}`"
                  title="删除分组"
                  ><DeleteOutlined
                /></a-button>
              </a-popconfirm>
            </template>
          </template>
        </div>
        <template v-if="isGroupOpen(group.name)">
          <div class="configured-tags">
            <div
              v-for="tag in paginateTags(
                group.tags,
                pageForGroup(group.name, group.tags.length),
                TAG_PAGE_SIZE
              )"
              :key="tag.id"
              class="configured-tag"
              :class="{ dragging: draggedTagId === tag.id, editing: editingId === tag.id }"
              :draggable="!readonly && editingId !== tag.id"
              :aria-label="`拖动 ${tagLabel(tag)} 到其他分组`"
              @dragstart="startDrag($event, tag)"
              @dragend="endDrag"
            >
              <div v-if="!readonly" class="tag-color" :title="`设置 ${tagLabel(tag)} 的颜色`">
                <ColorPicker
                  :pure-color="tagStore.getColor(tag)"
                  @update:pure-color="changeColor(tag, $event)"
                />
              </div>
              <a-input
                v-if="editingId === tag.id"
                v-model:value="editingName"
                class="rename-input"
                :maxlength="40"
                :aria-label="`修改标签名称：${tagLabel(tag)}`"
                :disabled="busy"
                @keydown="handleRenameKeydown($event, tag)"
              />
              <span v-else class="tag-name" :title="tagLabel(tag)">{{ tagLabel(tag) }}</span>
              <span v-if="tag.name === 'like'" class="tag-note" title="内置收藏标签">内置</span>
              <span v-else-if="usesRule(tag)" class="tag-note" title="用于自动打标规则">规则</span>
              <div class="tag-actions">
                <template v-if="editingId === tag.id">
                  <a-button size="small" type="primary" :loading="busy" @click="saveRename(tag)"
                    >保存</a-button
                  >
                  <a-button size="small" :disabled="busy" @click="cancelRename">取消</a-button>
                </template>
                <template v-else>
                  <a-dropdown v-if="groupNames.length" trigger="click">
                    <a-button
                      size="small"
                      type="text"
                      class="tag-action"
                      :disabled="readonly || busy"
                      :aria-label="`移动标签 ${tagLabel(tag)} 到其他分组`"
                      title="移动到其他分组"
                      ><FolderOpenOutlined
                    /></a-button>
                    <template #overlay
                      ><a-menu>
                        <a-menu-item v-if="group.name" @click="moveTag(tag, '')"
                          >未分组</a-menu-item
                        >
                        <a-menu-item
                          v-for="option in groupNames.filter((option) => option !== group.name)"
                          :key="option"
                          @click="moveTag(tag, option)"
                          >{{ option }}</a-menu-item
                        >
                      </a-menu></template
                    >
                  </a-dropdown>
                  <a-button
                    v-if="tag.name !== 'like'"
                    size="small"
                    type="text"
                    class="tag-action"
                    :disabled="readonly || busy"
                    :aria-label="`修改标签名称：${tagLabel(tag)}`"
                    title="修改标签名称"
                    @click="startRename(tag)"
                    ><EditOutlined
                  /></a-button>
                  <a-popconfirm
                    v-if="tag.name !== 'like'"
                    title="删除此标签及其图片关联？图片文件会保留。"
                    :disabled="readonly || busy || usesRule(tag)"
                    @confirm="remove(tag)"
                  >
                    <a-button
                      size="small"
                      type="text"
                      danger
                      class="tag-action"
                      :disabled="readonly || busy || usesRule(tag)"
                      :aria-label="`删除标签：${tagLabel(tag)}`"
                      :title="usesRule(tag) ? '请先移除使用此标签的自动打标规则' : '删除标签'"
                      ><DeleteOutlined
                    /></a-button>
                  </a-popconfirm>
                </template>
              </div>
            </div>
          </div>
          <div v-if="pageCount(group.tags.length) > 1" class="tag-page-controls">
            <a-button
              size="small"
              :disabled="pageForGroup(group.name, group.tags.length) === 1"
              @click="setTagPage(group.name, pageForGroup(group.name, group.tags.length) - 1)"
              >上一页</a-button
            >
            <span
              >第 {{ pageForGroup(group.name, group.tags.length) }} /
              {{ pageCount(group.tags.length) }} 页</span
            >
            <a-button
              size="small"
              :disabled="
                pageForGroup(group.name, group.tags.length) === pageCount(group.tags.length)
              "
              @click="setTagPage(group.name, pageForGroup(group.name, group.tags.length) + 1)"
              >下一页</a-button
            >
          </div>
          <form class="create-tag group-create-tag" @submit.prevent="add(group.name)">
            <a-input
              v-model:value="newTagNames[group.name]"
              :placeholder="`在${group.name || '未分组'}中添加标签`"
              :aria-label="`在${group.name || '未分组'}中添加标签`"
              :disabled="readonly || busy"
              :maxlength="40"
              allow-clear
            />
            <a-button
              html-type="submit"
              :disabled="readonly || !newTagNames[group.name]?.trim()"
              :loading="busy"
              >添加标签</a-button
            >
          </form>
        </template>
      </section>
      <a-button
        v-if="filteredGroups.length > visibleGroupCount"
        class="load-more-groups"
        @click="visibleGroupCount += GROUP_PAGE_SIZE"
        >再显示
        {{ Math.min(GROUP_PAGE_SIZE, filteredGroups.length - visibleGroupCount) }} 个分组</a-button
      >
    </SettingsGroup>
    <AutoTagSettings :tag-rename="tagRename" />
  </div>
</template>

<style scoped>
.tag-configuration {
  container-type: inline-size;
}
.tag-search-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
}
.tag-search-row .ant-input-affix-wrapper {
  flex: 1;
  max-width: 420px;
  min-width: 0;
}
.tag-search-count {
  color: var(--zp-secondary);
  font-size: 12px;
}
.create-tag {
  display: flex;
  gap: 8px;
  min-width: 0;
  margin: 0 0 16px;
}
.create-tag .ant-input-affix-wrapper {
  min-width: 0;
  flex: 1;
}
.tag-group-section {
  border-top: 1px solid var(--ui-border);
  padding: 10px 0;
  transition: background-color var(--ui-motion-fast);
}
.tag-group-section.drop-target {
  background: var(--ui-surface-soft);
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
  border-radius: var(--ui-radius-sm);
}
.tag-group-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
}
.group-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.group-toggle > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-toggle small {
  flex: none;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--ui-surface-soft);
  color: var(--zp-secondary);
  font-size: 11px;
  font-weight: 400;
}
.group-toggle .anticon {
  flex: none;
  font-size: 10px;
  transform: rotate(-90deg);
  transition: transform var(--ui-motion-fast);
}
.group-toggle .anticon.expanded {
  transform: rotate(0);
}
.group-toggle:focus-visible,
.tag-action:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.group-rename {
  max-width: 220px;
}
.configured-tags {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 6px 12px;
  margin: 10px 0;
}
.configured-tag {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-soft);
}
.configured-tag[draggable='true'] {
  cursor: grab;
}
.configured-tag:hover,
.configured-tag:focus-within {
  border-color: var(--ui-control-border);
}
.configured-tag.dragging {
  opacity: 0.5;
}
.tag-color {
  width: 20px;
  height: 20px;
  flex: none;
}
.tag-name {
  font-size: 13px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-note {
  flex: none;
  font-size: 11px;
  color: var(--zp-secondary);
}
.rename-input {
  flex: 1;
  min-width: 0;
  width: 100px;
}
.tag-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex: none;
}
.tag-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
}
@media (hover: hover) and (pointer: fine) {
  .configured-tag:not(.editing) .tag-actions,
  .tag-group-heading > .tag-action {
    opacity: 0;
  }
  .configured-tag:hover .tag-actions,
  .configured-tag:focus-within .tag-actions,
  .tag-group-heading:hover > .tag-action,
  .tag-group-heading:focus-within > .tag-action {
    opacity: 1;
  }
}
.group-create-tag {
  margin: 10px 0 4px;
  max-width: 480px;
}
.tag-page-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 12px 0;
  color: var(--zp-secondary);
  font-size: 12px;
}
.load-more-groups {
  display: block;
  margin: 12px auto 16px;
}
.tag-search-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--zp-secondary);
  font-size: 13px;
}
@container (max-width: 520px) {
  .tag-search-row {
    flex-wrap: wrap;
    gap: 8px;
  }
  .tag-search-row .ant-input-affix-wrapper {
    flex-basis: 100%;
    max-width: none;
  }
  .configured-tags {
    grid-template-columns: minmax(0, 1fr);
  }
  .tag-group-heading {
    flex-wrap: wrap;
  }
}
</style>
