<script setup lang="ts">
import { ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { saveFolderIcon } from '@/api/folderIcons'
import { useGlobalStore } from '@/store/useGlobalStore'
import { iconChoices, storedFolderIcon } from './folderIconChoices'
import { FolderOutlined, HddOutlined } from '@ant-design/icons-vue'

const props = defineProps<{ open: boolean; path: string; name: string; root?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const global = useGlobalStore()
const chosen = ref('')
const saving = ref(false)
watch(() => [props.open, props.path], () => {
  if (props.open) chosen.value = storedFolderIcon(global.folderIcons, props.path, global.conf?.is_win)
}, { immediate: true })

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5_000_000) {
    message.error('请选择不超过 5 MB 的 PNG、JPG、WebP 或 GIF 图片')
    return
  }
  try {
    const image = await createImageBitmap(file)
    try {
      if (image.width > 4096 || image.height > 4096) throw new Error('图片边长不能超过 4096 像素')
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 80
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法处理图片')
      const scale = Math.min(64 / image.width, 64 / image.height)
      const width = image.width * scale
      const height = image.height * scale
      context.drawImage(image, (80 - width) / 2, (80 - height) / 2, width, height)
      const data = canvas.toDataURL('image/png')
      if (data.length > 90_000) throw new Error('图标处理后仍过大，请换一张图片')
      chosen.value = data
    } finally { image.close() }
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '无法处理这张图片')
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    await saveFolderIcon(props.path, chosen.value)
    if (chosen.value) global.folderIcons[props.path] = chosen.value
    else delete global.folderIcons[props.path]
    message.success('目录图标已更新')
    emit('close')
  } catch (cause: any) {
    message.error(cause?.response?.data?.detail || '保存目录图标失败')
  } finally { saving.value = false }
}
</script>

<template>
  <a-modal :open="open" :title="`目录图标 · ${name}`" :confirm-loading="saving" ok-text="保存" cancel-text="取消" :width="540" @ok="save" @cancel="emit('close')">
    <p class="picker-hint">选择常用图标，或上传图片自动缩放为透明背景的方形图标。</p>
    <div class="icon-choices" role="group" aria-label="预设目录图标">
      <button type="button" :class="{active: !chosen}" @click="chosen = ''"><HddOutlined v-if="root" /><FolderOutlined v-else /><span>默认</span></button>
      <button v-for="choice in iconChoices" :key="choice.id" type="button" :class="{active: chosen === choice.id}" @click="chosen = choice.id"><component :is="choice.icon" /><span>{{ choice.label }}</span></button>
    </div>
    <div class="upload-row">
      <label class="upload-button">上传图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="上传目录图标图片" @change="upload" /></label>
      <span>最大 5 MB；会缩放到 80×80，保留原图比例。</span>
      <img v-if="chosen.startsWith('data:image/png;base64,')" :src="chosen" alt="自定义图标预览" />
    </div>
  </a-modal>
</template>

<style scoped>
.picker-hint { color: var(--zp-secondary); font-size: 12px; margin: 4px 0 14px; }
.icon-choices { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 7px; }
.icon-choices button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 62px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-surface); color: var(--ui-text); cursor: pointer; font-size: 11px; }
.icon-choices button :deep(.anticon) { font-size: 20px; }
.icon-choices button.active { border-color: var(--primary-color); background: var(--primary-color-1); color: var(--primary-color); }
.icon-choices button:hover { border-color: var(--primary-color); }
.upload-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 16px; font-size: 11px; color: var(--zp-secondary); }
.upload-row img { width: 34px; height: 34px; object-fit: contain; }
.upload-button { position: relative; display: inline-flex; align-items: center; min-height: 32px; padding: 0 10px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-surface); color: var(--ui-text); cursor: pointer; }
.upload-button:focus-within { outline: 2px solid var(--primary-color); outline-offset: 2px; }
.upload-button input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
@media(max-width:560px) { .icon-choices { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
</style>
