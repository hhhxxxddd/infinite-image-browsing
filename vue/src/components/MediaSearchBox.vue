<script setup lang="ts">
import { ref } from 'vue'
import { PictureOutlined, RobotOutlined, SearchOutlined } from '@ant-design/icons-vue'
import SearchSyntaxHelp from './SearchSyntaxHelp.vue'
import { getFileTransferDataFromDragEvent } from '@/util/file'

const props = defineProps<{
  modelValue: string
  semanticMode: boolean
  label?: string
  placeholder?: string
  helpFirst?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  'mode-change': [semantic: boolean]
  'image-file': [file: File]
  'image-path': [path: string]
  example: [query: string]
}>()
const chooser = ref<HTMLInputElement>()

function submit() { emit('submit') }
function onEnter(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  submit()
}
function chooseImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('image-file', file)
  input.value = ''
}
function dropImage(event: DragEvent) {
  const transfer = getFileTransferDataFromDragEvent(event)
  if (transfer?.nodes[0]) { emit('image-path', transfer.nodes[0].fullpath); return }
  const file = event.dataTransfer?.files[0]
  if (file?.type.startsWith('image/')) emit('image-file', file)
}
function pasteImage(event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.items ?? [])
    .find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
  if (!file) return
  event.preventDefault()
  emit('image-file', file)
}
</script>

<template>
  <div class="media-search-box" :class="{ 'help-first': helpFirst }">
    <form class="header-library-search" :class="{ 'semantic-mode': semanticMode }" @submit.prevent="submit" @dragover.prevent @drop.prevent="dropImage">
      <input :value="modelValue" :aria-label="semanticMode ? '按画面内容搜索' : label || '搜索媒体库'"
        :placeholder="semanticMode ? '描述想找的画面，回车搜索' : placeholder || '搜索文件名、标签、描述，或拖入/粘贴图片'"
        :maxlength="semanticMode ? 500 : undefined" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keydown.enter="onEnter" @paste="pasteImage" />
      <button type="submit" :title="semanticMode ? '搜索画面' : '搜索'" :aria-label="semanticMode ? '搜索画面' : '搜索'"><SearchOutlined /></button>
      <button class="semantic-entry" type="button" :title="semanticMode ? '切换到文字搜索' : '切换到 AI 画面搜索'"
        :aria-label="semanticMode ? '切换到文字搜索' : '切换到 AI 画面搜索'" :aria-pressed="semanticMode"
        @click="emit('mode-change', !semanticMode)"><RobotOutlined /></button>
      <button type="button" title="以图搜图：选择或粘贴图片" aria-label="以图搜图：选择参考图片" @click="chooser?.click()"><PictureOutlined /></button>
      <input ref="chooser" class="image-search-input" type="file" accept=".png,.jpg,.jpeg,.webp,.avif,.bmp,.gif,.jpe"
        aria-label="搜索框参考图片" @change="chooseImage" />
    </form>
    <SearchSyntaxHelp icon-only :semantic-mode="semanticMode" @example="emit('example', $event)" />
  </div>
</template>

<style scoped>
.media-search-box{display:flex;align-items:center;flex:1;min-width:0;gap:4px}
.media-search-box.help-first{flex-direction:row-reverse}
.header-library-search{display:flex;flex:1;min-width:60px;align-items:center;height:36px;border:1px solid var(--zp-border);border-radius:7px;background:var(--ui-search-glass);padding:0 6px 0 12px}
.header-library-search:focus-within{border-color:var(--primary-color)}
.header-library-search.semantic-mode{border-color:var(--primary-color);box-shadow:0 0 0 2px var(--primary-color-1),0 0 14px 1px var(--primary-color-2)}
.header-library-search.semantic-mode:focus-within{box-shadow:0 0 0 3px var(--primary-color-2),0 0 17px 2px var(--primary-color-2)}
.header-library-search>input:not([type="file"]){flex:1;width:0;min-width:0;font:inherit;font-size:13px;border:0;outline:0;background:transparent;color:var(--zp-primary)}
.header-library-search>button{width:30px;height:30px;flex-shrink:0;display:grid;place-items:center;background:none;border:0;border-radius:4px;cursor:pointer;font-size:16px;color:var(--zp-secondary)}
.header-library-search>button.semantic-entry[aria-pressed="true"]{background:var(--primary-color-2);color:var(--primary-color)}
.header-library-search>button:hover{background:var(--primary-color-1);color:var(--primary-color)}
.image-search-input{display:none}
</style>
