<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  audioCoverUrl,
  updateAudioMetadata,
  type AudioMetadata,
  type FileNodeInfo
} from '@/features/media-library/public'
import { useApplicationStore } from '@/features/application/public'
import { getErrorMessage } from '@/shared/lib/errorMessage'

const props = defineProps<{
  file?: FileNodeInfo
  metadata?: AudioMetadata
  loading: boolean
  error: string
  beforeSave: () => Promise<void>
}>()
const emit = defineEmits<{
  reload: []
  updated: [metadata: AudioMetadata]
  editing: [value: boolean]
  settled: []
}>()
const global = useApplicationStore()
const editing = ref(false),
  saving = ref(false),
  saveError = ref('')
const coverInput = ref<HTMLInputElement>()
const titleInput = ref<HTMLInputElement>()
const editRevision = ref('')
const draft = reactive({ title: '', artist: '', album: '', cover: '', removeCover: false })
const writable = computed(
  () =>
    !!props.file &&
    !!props.metadata?.editable &&
    !props.file.workspace_artifact_id &&
    !global.conf?.is_readonly
)
const coverSource = computed(() => {
  const source = props.metadata?.cover_source
  return source === 'embedded'
    ? '内嵌封面'
    : source === 'same_name'
      ? '同名图片'
      : source === 'directory'
        ? '目录封面'
        : '无封面'
})
const sourceCoverUrl = computed(() =>
  props.file && props.metadata?.has_cover ? audioCoverUrl(props.file, props.metadata.revision) : ''
)
const coverUrl = computed(() => {
  if (editing.value && draft.cover) return draft.cover
  if (editing.value && draft.removeCover) return ''
  return sourceCoverUrl.value
})
let disposed = false
let coverReadId = 0
onUnmounted(() => {
  disposed = true
  emit('editing', false)
})
function popupContainer() {
  return document.fullscreenElement instanceof HTMLElement
    ? document.fullscreenElement
    : document.body
}
function openChanged(open: boolean) {
  if (open) void begin()
  else cancel()
}
async function begin() {
  if (editing.value || !writable.value || !props.metadata) return
  coverReadId++
  editRevision.value = props.metadata.revision
  Object.assign(draft, {
    title: props.metadata.embedded_title,
    artist: props.metadata.artist,
    album: props.metadata.album,
    cover: '',
    removeCover: false
  })
  saveError.value = ''
  editing.value = true
  emit('editing', true)
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
}
function cancel() {
  if (saving.value) return
  coverReadId++
  editing.value = false
  emit('editing', false)
}
function removeCover() {
  coverReadId++
  draft.cover = ''
  draft.removeCover = true
}
async function chooseCover(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  const requestId = ++coverReadId
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  ) {
    saveError.value = '请选择 JPEG、PNG 或 WebP，最大 8 MB'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    if (disposed || !editing.value || requestId !== coverReadId) return
    draft.cover = String(reader.result)
    draft.removeCover = false
    saveError.value = ''
  }
  reader.onerror = () => {
    if (!disposed && requestId === coverReadId) saveError.value = '封面读取失败，请重新选择'
  }
  reader.readAsDataURL(file)
}
async function save() {
  const file = props.file,
    metadata = props.metadata
  if (!file || !metadata || !writable.value || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    await props.beforeSave()
    const result = await updateAudioMetadata({
      path: file.fullpath,
      revision: editRevision.value,
      title: draft.title,
      artist: draft.artist,
      album: draft.album,
      ...(draft.cover ? { cover: draft.cover } : {}),
      remove_cover: draft.removeCover
    })
    if (disposed) return
    emit('updated', result)
    editing.value = false
    emit('editing', false)
    message.success('歌曲信息已写入 MP3 文件')
  } catch (cause) {
    if (!disposed) saveError.value = getErrorMessage(cause, '歌曲信息保存失败')
  } finally {
    saving.value = false
    emit('settled')
  }
}
function editKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    void save()
  }
}
</script>

<template>
  <section class="audio-metadata" aria-label="音频元数据" @keydown.stop @wheel.stop>
    <div class="audio-metadata-heading">
      <strong>音频元数据</strong>
      <a-popover
        v-if="writable"
        :open="editing"
        trigger="click"
        placement="bottomRight"
        overlay-class-name="preview-metadata-edit-popover"
        :get-popup-container="popupContainer"
        :z-index="1010"
        destroy-tooltip-on-hide
        @open-change="openChanged"
      >
        <template #content>
          <form
            class="audio-tag-editor"
            aria-label="编辑歌曲信息"
            @submit.prevent="save"
            @keydown="editKeydown"
            @wheel.stop
          >
            <strong>编辑歌曲信息</strong>
            <fieldset :disabled="saving">
              <label
                >歌曲名<input
                  ref="titleInput"
                  v-model="draft.title"
                  maxlength="1000"
                  placeholder="未填写时显示文件名"
              /></label>
              <label>艺术家<input v-model="draft.artist" maxlength="1000" /></label>
              <label>专辑<input v-model="draft.album" maxlength="1000" /></label>
              <div class="audio-tag-cover-editor">
                <img v-if="coverUrl" class="audio-tag-cover" :src="coverUrl" alt="歌曲封面预览" />
                <div class="audio-tag-buttons">
                  <a-button @click="coverInput?.click()">替换内嵌封面</a-button>
                  <a-button
                    v-if="metadata?.cover_source === 'embedded' || draft.cover"
                    @click="removeCover"
                  >
                    移除内嵌封面
                  </a-button>
                </div>
              </div>
              <input
                ref="coverInput"
                class="cover-file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                @change="chooseCover"
              />
              <small
                >保存会写入 MP3
                的歌曲标签和封面，不重新编码声音。移除内嵌封面后仍可使用同名或目录封面。</small
              >
              <p v-if="saveError" class="audio-tag-error" role="alert">{{ saveError }}</p>
              <div class="audio-tag-buttons audio-tag-footer">
                <a-button @click="cancel">取消</a-button>
                <a-button type="primary" html-type="submit" :loading="saving"
                  >写入 MP3 文件</a-button
                >
              </div>
            </fieldset>
          </form>
        </template>
        <button type="button" :disabled="loading" @click="begin">编辑歌曲信息</button>
      </a-popover>
    </div>
    <p v-if="loading">正在读取音频标签…</p>
    <p v-else-if="!metadata">
      {{ props.error || '没有读取到音频标签' }} <button @click="emit('reload')">重新读取</button>
    </p>
    <template v-else>
      <img v-if="sourceCoverUrl" class="audio-tag-cover" :src="sourceCoverUrl" alt="歌曲封面" />
      <dl class="audio-tag-values">
        <div>
          <dt>歌曲名</dt>
          <dd>{{ metadata.title }}</dd>
        </div>
        <div>
          <dt>标题来源</dt>
          <dd>{{ metadata.title_source === 'embedded' ? '内嵌标签' : '文件名' }}</dd>
        </div>
        <div>
          <dt>艺术家</dt>
          <dd>{{ metadata.artist || '未填写' }}</dd>
        </div>
        <div>
          <dt>专辑</dt>
          <dd>{{ metadata.album || '未填写' }}</dd>
        </div>
        <div>
          <dt>封面来源</dt>
          <dd>{{ coverSource }}{{ metadata.cover_name ? ` · ${metadata.cover_name}` : '' }}</dd>
        </div>
        <div>
          <dt>歌词</dt>
          <dd>
            {{
              metadata.lyrics
                ? `${metadata.lyrics.source === 'embedded' ? '内嵌' : '同名文件'} · ${metadata.lyrics.timed ? '带时间戳' : '纯文字'}`
                : '未发现'
            }}
          </dd>
        </div>
      </dl>
      <small v-if="!metadata.editable">此格式可读取歌曲信息，标签写入目前支持 MP3。</small>
    </template>
  </section>
</template>

<style scoped>
.audio-metadata {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.audio-metadata-heading,
.audio-tag-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.audio-metadata-heading {
  justify-content: space-between;
}
.audio-metadata-heading strong {
  font-size: 12px;
}
.audio-metadata button {
  border: 1px solid #ffffff25;
  border-radius: 6px;
  padding: 5px 8px;
  background: #ffffff08;
  color: #b5d4ff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.audio-tag-cover {
  width: 112px;
  height: 112px;
  object-fit: contain;
  background: #131a23;
  border-radius: 8px;
}
.audio-tag-editor {
  width: min(420px, calc(100vw - 64px));
  max-height: calc(100dvh - 100px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
  padding-right: 8px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--ui-text);
  font: 13px/1.6 var(--ui-font);
}
.audio-tag-editor fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.audio-tag-editor label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.audio-tag-editor label input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  background: var(--ui-surface);
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  padding: 8px;
  font: inherit;
}
.cover-file-input {
  display: none;
}
.audio-tag-cover-editor {
  display: flex;
  gap: 12px;
  align-items: center;
}
.audio-tag-cover-editor .audio-tag-cover {
  width: 80px;
  height: 80px;
  flex-shrink: 0;
}
.audio-tag-footer {
  justify-content: flex-end;
  border-top: 1px solid var(--ui-border);
  padding-top: 12px;
}
.audio-tag-values {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  font-size: 12px;
}
.audio-tag-values > div {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 8px;
}
.audio-tag-values dt,
.audio-metadata small {
  color: #8996a8;
}
.audio-tag-editor small {
  color: var(--ui-muted);
}
.audio-tag-values dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.audio-metadata small,
.audio-tag-editor small {
  line-height: 1.7;
}
.audio-tag-error {
  color: #ff7875;
}
.audio-metadata button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
