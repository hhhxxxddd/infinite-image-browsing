<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import {
  ArrowRightOutlined,
  MoreOutlined,
  PlusOutlined,
  LoadingOutlined
} from '@ant-design/icons-vue'
import { getErrorMessage } from '@/shared/lib/errorMessage'
import {
  getWorkspaceOverviews,
  uploadWorkspaceCover,
  workspaceCoverUrl,
  workspaceArtifactCoverUrl,
  type WorkspaceOverview
} from '../api/workspaceHome'
import type { WorkspaceRecord, WorkspaceStatus } from '../model/workspaceModel'

const props = defineProps<{
  records: WorkspaceRecord[]
  view: WorkspaceStatus
  saving?: boolean
  readonly?: boolean
  saveCover: (id: string, version?: string) => Promise<boolean>
}>()
const emit = defineEmits<{
  'update:view': [value: WorkspaceStatus]
  create: []
  open: [item: WorkspaceRecord]
  resume: [item: WorkspaceRecord, workId: string, draftId?: string]
  edit: [item: WorkspaceRecord]
  status: [item: WorkspaceRecord]
  remove: [item: WorkspaceRecord]
}>()
const overviews = ref<Record<string, WorkspaceOverview>>({})
const loading = ref(false)
const loadError = ref(false)
const coverInput = ref<HTMLInputElement>()
const coverTarget = ref<WorkspaceRecord>()
const uploading = ref('')
const failedImages = ref(new Set<string>())
let request = 0
onBeforeUnmount(() => request++)
async function refresh() {
  const current = ++request
  loading.value = true
  loadError.value = false
  try {
    const result = await getWorkspaceOverviews(props.records.map((item) => item.id))
    if (current === request)
      overviews.value = Object.fromEntries(result.map((item) => [item.workspace_id, item]))
  } catch {
    if (current === request) loadError.value = true
  } finally {
    if (current === request) loading.value = false
  }
}
watch(() => props.records.map((item) => item.id).join(','), refresh, { immediate: true })
const counts = computed(() => ({
  active: props.records.filter((item) => item.status === 'active').length,
  paused: props.records.filter((item) => item.status === 'paused').length
}))
const visible = computed(() =>
  props.records
    .filter((item) => item.status === props.view)
    .sort((a, b) => (b.lastOpenedAt || b.updatedAt).localeCompare(a.lastOpenedAt || a.updatedAt))
)
const disabled = computed(() => !!props.saving || !!props.readonly || !!uploading.value)
function coverSources(item: WorkspaceRecord) {
  const candidates = item.cover
    ? [workspaceCoverUrl(item.id, item.cover)]
    : (overviews.value[item.id]?.preview_artifacts ?? []).map(workspaceArtifactCoverUrl)
  return candidates.filter((url) => !failedImages.value.has(url))
}
function dateLabel(item: WorkspaceRecord) {
  const date = new Date(item.lastOpenedAt || item.updatedAt)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
function chooseCover(item: WorkspaceRecord) {
  if (disabled.value) return
  coverTarget.value = item
  coverInput.value?.click()
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const item = coverTarget.value
  coverTarget.value = undefined
  if (!file || !item || disabled.value) return
  if (file.size > 50 * 1024 * 1024) {
    message.warning('请选择 50MB 以内的图片')
    return
  }
  uploading.value = item.id
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('图片读取失败'))
      reader.readAsDataURL(file)
    })
    const version = await uploadWorkspaceCover(item.id, data)
    if (await props.saveCover(item.id, version)) message.success('封面已更新')
  } catch (error) {
    message.error(getErrorMessage(error, '上传封面失败'))
  } finally {
    uploading.value = ''
  }
}
async function removeCover(item: WorkspaceRecord) {
  if (!disabled.value && (await props.saveCover(item.id))) message.success('已恢复自动封面')
}
function resume(item: WorkspaceRecord) {
  const overview = overviews.value[item.id]
  if (overview?.recent_work)
    emit('resume', item, overview.recent_work.id, overview.recent_draft?.id)
  else emit('open', item)
}
</script>

<template>
  <section class="workspace-home" aria-label="工作区首页">
    <header class="home-toolbar">
      <div class="workspace-filters" role="group" aria-label="工作区状态">
        <button
          type="button"
          :aria-pressed="view === 'active'"
          @click="emit('update:view', 'active')"
        >
          进行中 <span>{{ counts.active }}</span>
        </button>
        <button
          type="button"
          :aria-pressed="view === 'paused'"
          @click="emit('update:view', 'paused')"
        >
          已搁置 <span>{{ counts.paused }}</span>
        </button>
      </div>
      <a-button type="primary" :disabled="disabled" @click="emit('create')"
        ><PlusOutlined />新建工作区</a-button
      >
    </header>
    <p v-if="loadError" class="home-error" role="status">
      作品记录暂时无法读取。<a-button type="link" size="small" @click="refresh">重试</a-button>
    </p>
    <input
      ref="coverInput"
      type="file"
      accept="image/*"
      class="cover-file-input"
      aria-label="上传工作区封面"
      @change="upload"
    />
    <div v-if="visible.length" class="workspace-grid">
      <article
        v-for="(item, index) in visible"
        :key="item.id"
        class="workspace-card"
        :class="{ recent: view === 'active' && index === 0 }"
      >
        <button
          type="button"
          class="workspace-entry"
          :aria-label="`进入工作区：${item.name}`"
          @click="emit('open', item)"
        >
          <span class="workspace-cover" :class="`cover-tone-${item.id.charCodeAt(0) % 4}`">
            <span
              v-if="coverSources(item).length"
              class="cover-images"
              :class="{ collage: coverSources(item).length > 1 }"
            >
              <img
                v-for="url in coverSources(item)"
                :key="url"
                :src="url"
                alt=""
                loading="lazy"
                @error="failedImages.add(url)"
              />
            </span>
            <span v-else class="cover-initials" aria-hidden="true">{{
              item.name.slice(0, 2)
            }}</span>
            <span v-if="view === 'active' && index === 0 && item.lastOpenedAt" class="recent-badge"
              >最近使用</span
            >
            <span v-if="uploading === item.id" class="cover-uploading"
              ><LoadingOutlined />正在上传</span
            >
          </span>
          <span class="workspace-copy">
            <strong>{{ item.name }}</strong>
            <span class="workspace-summary">{{
              overviews[item.id]?.recent_work?.name || item.brief || '从这里开始一个新作品'
            }}</span>
            <span class="workspace-counts" v-if="overviews[item.id]"
              >{{ overviews[item.id].work_count }} 个作品<span>·</span
              >{{ overviews[item.id].draft_count }} 个制作文件</span
            >
            <span class="workspace-counts" v-else>{{
              loading ? '正在读取作品…' : '作品记录暂时不可用'
            }}</span>
          </span>
        </button>
        <a-dropdown :trigger="['click']" placement="bottomRight">
          <a-button class="workspace-menu" type="text" :aria-label="`工作区操作：${item.name}`"
            ><MoreOutlined
          /></a-button>
          <template #overlay
            ><a-menu>
              <a-menu-item :disabled="disabled" @click="emit('edit', item)"
                >修改名称与目标</a-menu-item
              >
              <a-menu-item :disabled="disabled" @click="chooseCover(item)">{{
                item.cover ? '更换封面' : '上传封面'
              }}</a-menu-item>
              <a-menu-item v-if="item.cover" :disabled="disabled" @click="removeCover(item)"
                >移除自定义封面</a-menu-item
              >
              <a-menu-divider />
              <a-menu-item :disabled="disabled" @click="emit('status', item)">{{
                item.status === 'active' ? '搁置工作区' : '恢复工作区'
              }}</a-menu-item>
              <a-menu-item danger :disabled="disabled" @click="emit('remove', item)"
                >删除工作区</a-menu-item
              >
            </a-menu></template
          >
        </a-dropdown>
        <footer class="workspace-footer">
          <button
            type="button"
            :title="overviews[item.id]?.recent_draft?.name"
            @click="resume(item)"
          >
            <span>{{
              overviews[item.id]?.recent_draft
                ? `继续：${overviews[item.id].recent_draft?.name}`
                : item.status === 'paused'
                  ? '恢复并进入'
                  : '进入工作区'
            }}</span
            ><ArrowRightOutlined />
          </button>
          <time :datetime="item.lastOpenedAt || item.updatedAt">{{ dateLabel(item) }}</time>
        </footer>
      </article>
    </div>
    <div v-else class="workspace-home-empty">
      <PlusOutlined />
      <strong>{{ view === 'active' ? '还没有进行中的工作区' : '没有已搁置的工作区' }}</strong>
      <a-button v-if="view === 'active'" :disabled="disabled" @click="emit('create')"
        >新建工作区</a-button
      >
    </div>
  </section>
</template>

<style scoped>
.workspace-home {
  padding: 4px 0 24px;
}
.home-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}
.workspace-filters {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: var(--ui-surface-soft);
  border-radius: 9px;
}
.workspace-filters button {
  border: 0;
  border-radius: 6px;
  padding: 7px 12px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.workspace-filters button[aria-pressed='true'] {
  color: var(--primary-color);
  background: var(--ui-surface);
  box-shadow: 0 1px 4px rgb(0 0 0 / 5%);
}
.workspace-filters span {
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.75;
}
.workspace-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 320px));
  gap: 22px;
  align-items: start;
}
.workspace-card {
  position: relative;
  overflow: hidden;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-surface);
  box-shadow: 0 3px 16px rgb(0 0 0 / 3%);
  transition:
    box-shadow 0.15s,
    border-color 0.15s;
}
.workspace-card:hover,
.workspace-card:focus-within {
  border-color: color-mix(in srgb, var(--primary-color) 35%, var(--ui-border));
  box-shadow: 0 7px 24px rgb(0 0 0 / 7%);
}
.workspace-entry {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.workspace-cover {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 8/5;
  overflow: hidden;
  isolation: isolate;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--primary-color) 22%, var(--ui-surface-soft)),
    var(--ui-surface-soft)
  );
}
.cover-tone-1 {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, #618579 30%, var(--ui-surface-soft)),
    var(--ui-surface-soft)
  );
}
.cover-tone-2 {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, #9485b4 30%, var(--ui-surface-soft)),
    var(--ui-surface-soft)
  );
}
.cover-tone-3 {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, #a7906f 30%, var(--ui-surface-soft)),
    var(--ui-surface-soft)
  );
}
.workspace-cover::after {
  content: '';
  position: absolute;
  width: 70%;
  aspect-ratio: 1;
  border: 1px solid rgb(255 255 255 / 20%);
  border-radius: 50%;
  right: -20%;
  bottom: -65%;
  pointer-events: none;
  z-index: -1;
}
.cover-initials {
  font-size: 42px;
  font-weight: 550;
  letter-spacing: 5px;
  opacity: 0.45;
}
.cover-images {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 3px;
}
.cover-images.collage {
  grid-template-columns: 2fr 1fr;
  grid-template-rows: 1fr 1fr;
}
.cover-images img {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  object-fit: cover;
}
.cover-images.collage img:first-child {
  grid-row: 1/-1;
}
.cover-images.collage img:last-child:nth-child(2) {
  grid-row: 1/-1;
}
.recent-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgb(16 25 35 / 58%);
  backdrop-filter: blur(10px);
  color: #fff;
  font-size: 10px;
}
.cover-uploading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgb(16 25 35 / 40%);
  color: #fff;
  font-size: 12px;
}
.workspace-copy {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 17px 18px 8px;
}
.workspace-copy strong {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.workspace-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--ui-muted);
}
.workspace-counts {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--ui-muted);
}
.workspace-counts > span {
  opacity: 0.6;
}
.workspace-menu {
  position: absolute;
  right: 10px;
  top: 10px;
  width: 30px;
  height: 30px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 20%);
  border-radius: 8px;
  color: var(--ui-text);
  background: color-mix(in srgb, var(--ui-surface) 87%, transparent);
  backdrop-filter: blur(12px);
}
.workspace-menu:hover {
  background: var(--ui-surface);
}
.workspace-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px 16px;
}
.workspace-footer button {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--primary-color);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.workspace-footer button > span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.workspace-footer time {
  font-size: 10px;
  color: var(--ui-muted);
  white-space: nowrap;
}
.workspace-entry:focus-visible,
.workspace-footer button:focus-visible,
.workspace-filters button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
  border-radius: 6px;
}
.cover-file-input {
  display: none;
}
.home-error {
  color: var(--ui-muted);
  font-size: 12px;
}
.workspace-home-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 320px;
  color: var(--ui-muted);
}
.workspace-home-empty > .anticon {
  font-size: 32px;
  opacity: 0.5;
}
.workspace-home-empty strong {
  font-size: 14px;
  font-weight: 500;
}
@media (max-width: 640px) {
  .workspace-grid {
    grid-template-columns: minmax(0, 1fr);
    max-width: 420px;
  }
  .home-toolbar {
    gap: 8px;
  }
  .workspace-filters button {
    padding: 6px 8px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .workspace-card {
    transition: none;
  }
}
</style>
