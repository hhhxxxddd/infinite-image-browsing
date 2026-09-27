<script setup lang="ts">
import { getErrorMessage } from '@/shared/lib/errorMessage'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import { getImageEditHistory, type ImageEditRecord } from '@/features/media-library/public'
import {
  createImageLayer,
  createStudioDocument,
  type StudioDocument
} from '@/features/image-editor/public'
import { studioImageDimensions } from '@/features/image-editor/public'
import ImageCreationStudio from '@/features/image-editor/components/ImageCreationStudio.vue'
import '@/features/image-editor/styles/studioEditorShell.css'

const props = defineProps<{ file: FileNodeInfo; readonly?: boolean }>()
const emit = defineEmits<{ exit: []; saved: [file: FileNodeInfo, overwrite: boolean] }>()
const doc = ref<StudioDocument>()
const editRecord = ref<ImageEditRecord>()
const activeFile = ref(props.file)
const error = ref('')
const assetInfo = ref<Record<string, FileNodeInfo>>({ [props.file.fullpath]: props.file })
const files = ref<FileNodeInfo[]>([props.file])
const assets = computed(() =>
  files.value.map((file) => ({ path: file.fullpath, name: file.name, kind: 'image' as const }))
)
const note = ref('')
const studio = ref<InstanceType<typeof ImageCreationStudio>>()
defineExpose({
  requestExit: () => studio.value?.requestExit(),
  saving: computed(() => !!studio.value?.saving)
})
let disposed = false
const page = document.getElementById('omnigallery-app')
const wasInert = page?.inert ?? false
if (page) page.inert = true
function registerLibraryImage(file: FileNodeInfo) {
  assetInfo.value[file.fullpath] = file
  if (!files.value.some((item) => item.fullpath === file.fullpath)) files.value.push(file)
}
function saved(file: FileNodeInfo, overwrite: boolean, record: ImageEditRecord) {
  activeFile.value = file
  editRecord.value = record
  Object.assign(assetInfo.value, record.asset_info, { [file.fullpath]: file })
  emit('saved', file, overwrite)
}
onMounted(async () => {
  try {
    const { record } = await getImageEditHistory(props.file.fullpath)
    if (disposed) return
    if (record) {
      editRecord.value = record
      Object.assign(assetInfo.value, record.asset_info)
      doc.value = record.document
      return
    }
    const size = await studioImageDimensions(props.file)
    if (disposed) return
    if (!size) throw new Error('无法读取原图')
    if (size.width > 16384 || size.height > 16384 || size.width * size.height > 100_000_000)
      throw new Error('图片过大，暂不支持调整')
    const initial = createStudioDocument(props.file.name.replace(/\.[^.]+$/, ''))
    initial.width = size.width
    initial.height = size.height
    initial.background = 'transparent'
    initial.layers = [
      createImageLayer(props.file.fullpath, { x: 0, y: 0, ...size }, props.file.name)
    ]
    doc.value = initial
  } catch (cause) {
    error.value = getErrorMessage(cause, '无法打开图片')
  }
})
onBeforeUnmount(() => {
  disposed = true
  if (page) page.inert = wasInert
})
</script>

<template>
  <div
    class="studio-editor-shell media-image-editor"
    role="dialog"
    aria-modal="true"
    aria-label="调整图片"
    @wheel.stop
    @touchmove.stop
  >
    <ImageCreationStudio
      ref="studio"
      v-if="doc"
      v-model:note="note"
      workspace-id=""
      workspace-name="媒体库"
      :media-file="activeFile"
      :initial-document="doc"
      :assets="assets"
      :asset-info="assetInfo"
      :readonly="readonly"
      :initial-export-area="editRecord?.export_area"
      :edit-revision="editRecord?.id"
      :edit-saved-at="editRecord?.updated_at"
      :note-dirty="false"
      :note-saving="false"
      standalone
      @library-image-picked="registerLibraryImage"
      @exit="emit('exit')"
      @media-saved="saved"
    />
    <div v-else class="media-editor-loading" role="status">
      <p>{{ error || '正在打开图片…' }}</p>
      <button type="button" @click="emit('exit')">返回预览</button>
    </div>
    <div v-if="doc && error" class="media-editor-error" role="alert">{{ error }}</div>
  </div>
</template>
<style scoped>
.media-image-editor {
  z-index: 950;
}
.media-editor-loading {
  margin: auto;
  text-align: center;
}
.media-editor-loading button {
  color: inherit;
  background: #ffffff15;
  border: 1px solid #ffffff25;
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
}
.media-editor-error {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #502a2a;
  color: #ffcaca;
  padding: 8px 14px;
  border-radius: 10px;
}
</style>
