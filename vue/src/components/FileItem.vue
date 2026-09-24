<script setup lang="ts">
import { tagLabel } from '@/util/tagLabel'
import { FileOutlined, FolderOpenOutlined, HeartOutlined, HeartFilled } from '@/icon'
import { useGlobalStore } from '@/store/useGlobalStore'
import { fallbackImage, ok } from 'vue3-ts-util'
import type { FileNodeInfo } from '@/api/files'
import { isImageFile, isVideoFile, isAudioFile } from '@/util'
import { toImageThumbnailUrl, toVideoCoverUrl, toRawFileUrl } from '@/util/file'
import type { MenuInfo } from 'ant-design-vue/lib/menu/src/interface'
import { computed, ref, nextTick, watch, onBeforeUnmount, inject } from 'vue'
import ContextMenu from './ContextMenu.vue'
import TagMenuItems from './TagMenuItems.vue'
import { useTagStore } from '@/store/useTagStore'
import { CloseCircleOutlined } from '@/icon'
import { Tag } from '@/api/db'
import { play } from '@/icon'
import { Top4MediaInfo } from '@/api'
import { mediaPreviewKey } from '@/util/mediaPreviewContext'
import { cardThumbnailShortEdge, mediaCardHeight } from '@/util/mediaCardLayout'
import { openPreviewWithFiles } from '@/util/mediaPreview'
import { ExportOutlined } from '@ant-design/icons-vue'
import { startDrag } from '@crabnebula/tauri-plugin-drag'
import { isTauri } from '@/util/env'
import dragIcon from '../../src-tauri/icons/32x32.png?inline'
import { message } from 'ant-design-vue'
import { invoke } from '@tauri-apps/api/core'
import { isAnimatedImage, mayBeAnimatedImage } from '@/util/mediaMotion'

const global = useGlobalStore()
const tagStore = useTagStore()
const previewMedia = inject(mediaPreviewKey, undefined)
function openMedia() {
  if (previewMedia) previewMedia(props.idx)
  else openPreviewWithFiles([props.file], 0)
}
function openImageEditor() {
  if (global.conf?.is_readonly) return
  if (previewMedia) previewMedia(props.idx, 'edit')
  else openPreviewWithFiles([props.file], 0, undefined, 'edit')
}

const props = withDefaults(
  defineProps<{
    file: FileNodeInfo,
    idx: number
    selected?: boolean
    nativeDragPaths?: string[]
    showMenuIdx?: number
    cellWidth: number
    displayHeight?: number
    enableRightClickMenu?: boolean,
    enableCloseIcon?: boolean,
    isSelectedMutilFiles?: boolean
    genInfo?: string
    extraTags?: Tag[]
    coverFiles?: Top4MediaInfo[]
  }>(),
  {
    selected: false, enableRightClickMenu: true, enableCloseIcon: false
  }
)

const emit = defineEmits<{
  'update:showMenuIdx': [v: number],
  'fileItemClick': [event: MouseEvent, file: FileNodeInfo, idx: number],
  'dragstart': [event: DragEvent, idx: number],
  'dragend': [event: DragEvent, idx: number],
  'dropToFolder': [event: DragEvent, file: FileNodeInfo, idx: number],
  'contextMenuClick': [e: MenuInfo, file: FileNodeInfo, idx: number],
  'close-icon-click': [],
  'imageDimensions': [path: string, width: number, height: number]
}>()

const customTags = computed(() => {
  return tagStore.tagMap.get(props.file.fullpath) ?? []
})
const cardTags = computed(() => props.extraTags ?? customTags.value)
const cardTagColumns = computed(() => props.cellWidth >= 220 ? 3 : 2)
const cardHeight = computed(() => props.displayHeight ?? mediaCardHeight(props.cellWidth))
const cardTagRows = computed(() => cardHeight.value >= 150 ? 2 : 0)
const cardTagCapacity = computed(() => cardTagColumns.value * cardTagRows.value)
const visibleCardTags = computed(() => cardTags.value.slice(0,
  cardTags.value.length > cardTagCapacity.value ? Math.max(0, cardTagCapacity.value - 1) : cardTagCapacity.value))
const hiddenCardTagCount = computed(() => cardTags.value.length - visibleCardTags.value.length)
const cardTagStyle = computed(() => ({
  '--card-tag-max-width': `${Math.floor((props.cellWidth - 20 - cardTagColumns.value * 4) / cardTagColumns.value)}px`
}))
const videoCoverSrc = computed(() => props.file.cover_url ?? toVideoCoverUrl(props.file))

const imageSrc = computed(() => {
  // Use a few cache-friendly short-edge sizes near the card's display size.
  const r = cardThumbnailShortEdge(Math.min(props.cellWidth, cardHeight.value), window.devicePixelRatio || 1, global.gridThumbnailResolution)
  return global.enableThumbnail ? toImageThumbnailUrl(props.file, [r, r].join('x'), 'short') : toRawFileUrl(props.file)
})

const imageContainerRef = ref<HTMLElement | null>(null)
const isImageNearViewport = ref(false)
const lazyImageSrc = computed(() => isImageNearViewport.value ? imageSrc.value : undefined)
const animatedImage = ref(false)
const motionChecked = ref(false)
const canEditImage = computed(() => props.file.type === 'file' && /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(props.file.name)
  && !global.conf?.is_readonly && (!mayBeAnimatedImage(props.file.name) || (motionChecked.value && !animatedImage.value)))
let imageObserver: IntersectionObserver | undefined

watch([() => props.file.fullpath, isImageNearViewport], async ([path, near], _, onCleanup) => {
  animatedImage.value = false
  motionChecked.value = false
  if (!near || !mayBeAnimatedImage(props.file.name)) return
  let cancelled = false
  onCleanup(() => { cancelled = true })
  try {
    const animated = await isAnimatedImage(props.file)
    if (!cancelled && props.file.fullpath === path) animatedImage.value = animated
  } catch { /* A failed probe must not block the card. */ }
  finally { if (!cancelled && props.file.fullpath === path) motionChecked.value = true }
}, { immediate: true })

function reportImageDimensions(image: HTMLImageElement) {
  if (!image.naturalWidth || !image.naturalHeight || image.getAttribute('src') === fallbackImage) return
  emit('imageDimensions', props.file.fullpath, image.naturalWidth, image.naturalHeight)
}
function onImageLoad(event: Event) {
  if (event.target instanceof HTMLImageElement) reportImageDimensions(event.target)
}

watch(imageContainerRef, (el) => {
  imageObserver?.disconnect()
  imageObserver = undefined
  if (el) void nextTick(() => {
    if (imageContainerRef.value !== el) return
    const image = el.querySelector<HTMLImageElement>('img.ant-image-img')
    if (image?.complete) reportImageDimensions(image)
  })
  if (!el || isImageNearViewport.value) return

  if (!('IntersectionObserver' in window)) {
    isImageNearViewport.value = true
    return
  }

  imageObserver = new IntersectionObserver((entries) => {
    if (!entries.some(entry => entry.isIntersecting)) return
    isImageNearViewport.value = true
    imageObserver?.disconnect()
    imageObserver = undefined
  }, { rootMargin: '400px 0px' })
  imageObserver.observe(el)
}, { flush: 'post' })

onBeforeUnmount(() => imageObserver?.disconnect())

const tags = computed(() => {
  const selectedIds = new Set(customTags.value.map(tag => tag.id))
  return (global.conf?.all_custom_tags ?? []).map(tag => ({ ...tag, selected: selectedIds.has(tag.id) })) as (Tag & { selected: boolean })[]
})

const likeTag = computed(() => tags.value.find(v => v.type === 'custom' && v.name === 'like'))

const taggleLikeTag = () => {
  ok(likeTag.value)
  emit('contextMenuClick', { key: `toggle-tag-${likeTag.value.id}` } as MenuInfo, props.file, props.idx)
}

const minShowDetailWidth = 112
const nativeDragArmed = ref(false)
let disarmNativeDrag: (() => void) | undefined
function armNativeDrag(event: PointerEvent) {
  if (event.button !== 0) return
  disarmNativeDrag?.()
  nativeDragArmed.value = true
  const startX = event.clientX
  const startY = event.clientY
  let started = false
  const onMove = (move: PointerEvent) => {
    if (started || !(move.buttons & 1) || Math.hypot(move.clientX - startX, move.clientY - startY) < 6) return
    started = true
    window.removeEventListener('pointermove', onMove)
    // The native file drag gives Explorer a real path. The card's HTML drag
    // remains available for sorting and moving files inside the library.
    const paths = props.selected && props.nativeDragPaths?.length ? props.nativeDragPaths : [props.file.fullpath]
    const pending = disarmNativeDrag
    void invoke<boolean>('can_native_drag', { paths }).then(allowed => {
      if (disarmNativeDrag !== pending) return
      if (!allowed) { message.warning('该位置暂不支持直接拖出，请使用导出或复制'); return }
      return startDrag({ item: paths, icon: dragIcon, mode: 'copy' })
    })
      .catch(() => message.error('无法拖出文件，请确认文件仍在原位置'))
      .finally(() => disarmNativeDrag?.())
  }
  const cleanup = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', cleanup)
    window.removeEventListener('pointercancel', cleanup)
    nativeDragArmed.value = false
    disarmNativeDrag = undefined
  }
  disarmNativeDrag = cleanup
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', cleanup)
  window.addEventListener('pointercancel', cleanup)
}
onBeforeUnmount(() => disarmNativeDrag?.())
const displayName = computed(() => props.file.type === 'file' ? props.file.name.replace(/\.[^.]+$/, '') || props.file.name : props.file.name)

const handleDragOver = (event: DragEvent) => {
  if (props.file.type !== 'dir') {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

const handleDrop = (event: DragEvent) => {
  if (props.file.type !== 'dir') {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  emit('dropToFolder', event, props.file, props.idx)
}

// 处理文件点击事件
function toggleSelection(event: MouseEvent) {
  emit('fileItemClick', new MouseEvent('click', { ctrlKey: true, shiftKey: event.shiftKey }), props.file, props.idx)
}
const isCardControl = (event: MouseEvent) => !!(event.target as HTMLElement).closest('.more, .selection-marker, .close-icon, .media-play-trigger')
const handleFileClick = (event: MouseEvent) => {
  if (isCardControl(event)) return
  if (props.file.type === 'file' && !event.isTrusted && event.detail === 0) {
    event.stopPropagation(); event.preventDefault(); openMedia(); return
  }
  if (props.file.type === 'dir') {
    // Programmatic image clicks are also used by fullscreen navigation.
    emit('fileItemClick', event, props.file, props.idx)
    return
  }
  event.stopPropagation()
  event.preventDefault()
  if (event.detail > 1) return
  toggleSelection(event)
}
const handleCardPreview = (event: MouseEvent) => {
  if (isCardControl(event) || props.file.type !== 'file') return
  event.stopPropagation()
  event.preventDefault()
  if (!props.selected) toggleSelection(event)
  openMedia()
}
const handleVideoClick = () => openMedia()
const handleAudioClick = () => openMedia()
</script>
<template>
  <a-dropdown :trigger="['contextmenu']" :open="!global.longPressOpenContextMenu ? undefined : typeof idx === 'number' && showMenuIdx === idx
    " @update:open="(v: boolean) => typeof idx === 'number' && emit('update:showMenuIdx', v ? idx : -1)">
    <li class="file file-item-trigger grid" :style="{ '--card-height': `${cardHeight}px` }" :class="{
    clickable: file.type === 'dir',
    selected
  }" :data-idx="idx" :key="file.name" :draggable="!nativeDragArmed" @dragstart="emit('dragstart', $event, idx)"
      @dragend="emit('dragend', $event, idx)" @dragover="handleDragOver" @drop="handleDrop"
      @click.capture="handleFileClick($event)" @dblclick.capture="handleCardPreview">

      <div>
        <button v-if="enableRightClickMenu" type="button" class="selection-marker" :class="{ checked: selected }"
          role="checkbox" :aria-checked="!!selected" :aria-label="(selected ? '取消选择：' : '选择：') + file.name"
          :title="selected ? '取消选择' : '选择（Shift 连选）'" @mousedown.stop @dragstart.prevent.stop
          @click.stop="toggleSelection">{{ selected ? '✓' : '' }}</button>
        <div class="close-icon" v-if="enableCloseIcon" @click="emit('close-icon-click')">
          <close-circle-outlined />
        </div>
        <div class="more" v-if="enableRightClickMenu">
          <button v-if="isTauri && file.type === 'file'" type="button" class="float-btn-wrap native-drag-handle"
            draggable="false" title="按住拖出到桌面或资源管理器" aria-label="拖出文件"
            @pointerdown.stop.prevent="armNativeDrag" @mousedown.stop.prevent @dragstart.prevent.stop @click.stop>
            <ExportOutlined />
          </button>
          <button v-if="canEditImage"
            type="button" class="float-btn-wrap edit-image" title="编辑图片" aria-label="编辑图片"
            @mousedown.stop @dragstart.prevent.stop @click.stop="openImageEditor">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4.5 19.5 9.5M13.2 5.8l-7 7 5 5 7-7a3.5 3.5 0 0 0-5-5Z"/><path d="M6 16c-2.4 0-3.5 1.4-3.5 3.5 0 1.1-.5 1.8-1.5 2.5 4.5.3 7-1.3 7-4a2.5 2.5 0 0 0-2.5-2.5Z"/></svg>
          </button>
          <a-dropdown v-if="file.type === 'file'" :trigger="['contextmenu']">
            <button class="float-btn-wrap" :class="{ 'like-selected': likeTag?.selected }" :title="likeTag?.selected ? '取消收藏（右键管理标签）' : '收藏（右键管理标签）'" :aria-label="likeTag?.selected ? '取消收藏' : '收藏'" @contextmenu.stop @click="taggleLikeTag">
              <HeartFilled v-if="likeTag?.selected" />
              <HeartOutlined v-else />
            </button>
            <template #overlay>
              <a-menu @click="emit('contextMenuClick', $event, file, idx)" v-if="tags.length > 1">
                <TagMenuItems :tags="tags" key-prefix="toggle-tag-" show-selection />
              </a-menu>
            </template>
          </a-dropdown>
        </div>

        <div ref="imageContainerRef" :key="file.fullpath" :class="`idx-${idx} item-content`" v-if="isImageFile(file.name)" @load.capture="onImageLoad">

          <a-image :src="lazyImageSrc" :fallback="fallbackImage" :alt="file.name" decoding="async" :preview="false" />
          <template v-if="animatedImage">
            <button type="button" class="media-play-trigger" :aria-label="'播放动图：' + file.name" title="播放动图" @click.stop="openMedia"><img :src="play" alt="" /></button>
          </template>
          <div class="tags-container" v-if="cardTags.length && cardTagRows && cellWidth > minShowDetailWidth" :style="cardTagStyle" :title="cardTags.map(tagLabel).join('、')">
            <a-tag v-for="tag in visibleCardTags" :key="tag.id" :color="tagStore.getColor(tag)">
              {{ tagLabel(tag) }}
            </a-tag>
            <span v-if="hiddenCardTagCount" class="more-tags">+{{ hiddenCardTagCount }}</span>
          </div>
        </div>
        <div :class="`idx-${idx} item-content video`" v-else-if="isVideoFile(file.name)">
          <img class="video-cover" :src="videoCoverSrc" alt="" decoding="async" @load="onImageLoad" />
          <button type="button" class="media-play-trigger" :aria-label="'播放视频：' + file.name" title="播放视频" @click.stop="handleVideoClick"><img :src="play" alt="" /></button>
          <div class="tags-container" v-if="cardTags.length && cardTagRows && cellWidth > minShowDetailWidth" :style="cardTagStyle" :title="cardTags.map(tagLabel).join('、')">
            <a-tag v-for="tag in visibleCardTags" :key="tag.id" :color="tagStore.getColor(tag)">
              {{ tagLabel(tag) }}
            </a-tag>
            <span v-if="hiddenCardTagCount" class="more-tags">+{{ hiddenCardTagCount }}</span>
          </div>
        </div>
        <div :class="`idx-${idx} item-content audio`" v-else-if="isAudioFile(file.name)"
          @click="handleAudioClick">
          <div class="audio-icon">🎵</div>
          <div class="tags-container" v-if="cardTags.length && cardTagRows && cellWidth > minShowDetailWidth" :style="cardTagStyle" :title="cardTags.map(tagLabel).join('、')">
            <a-tag v-for="tag in visibleCardTags" :key="tag.id" :color="tagStore.getColor(tag)">
              {{ tagLabel(tag) }}
            </a-tag>
            <span v-if="hiddenCardTagCount" class="more-tags">+{{ hiddenCardTagCount }}</span>
          </div>
        </div>
        <div v-else class="preview-icon-wrap">
          <file-outlined class="icon center" v-if="file.type === 'file'" />
          <div v-else-if="coverFiles?.length && cellWidth > 160" class="dir-cover-container">
            <img class="dir-cover-item" loading="lazy" decoding="async" fetchpriority="low"
              :src="item.media_type === 'image' ? toImageThumbnailUrl(item) : toVideoCoverUrl(item)"
              v-for="item in coverFiles" :key="item.fullpath">
          </div>

          <folder-open-outlined class="icon center" v-else />
        </div>
        <div class="card-caption" :title="file.name">
          <span class="caption-name">{{ displayName }}</span>
          <span v-if="cardTags.length && !cardTagRows && cellWidth > minShowDetailWidth" class="compact-tag-summary" :title="cardTags.map(tagLabel).join('、')" :style="{ backgroundColor: tagStore.getColor(cardTags[0]) }">
            <span class="compact-tag-name">{{ tagLabel(cardTags[0]) }}</span>
            <span v-if="cardTags.length > 1" class="compact-tag-more">+{{ cardTags.length - 1 }}</span>
          </span>
        </div>
      </div>
    </li>
    <template #overlay>
      <context-menu :file="file" :idx="idx" :selected-tag="customTags" v-if="enableRightClickMenu"
        @context-menu-click="(e, f, i) => emit('contextMenuClick', e, f, i)"
        :is-selected-mutil-files="selected && isSelectedMutilFiles" />
    </template>
  </a-dropdown>
</template>
<style lang="scss" scoped>
button.float-btn-wrap {border:0; padding:0; cursor:pointer; font:inherit; color:inherit;}
.selection-marker {position:absolute;left:8px;top:8px;z-index:2;width:21px;height:21px;border:1px solid var(--zp-border);border-radius:4px;background:var(--zp-primary-background);display:grid;place-items:center; &.checked {background:var(--primary-color);color:white;border-color:var(--primary-color);}}
.profile {padding-top:7px; .name {font-size:13px;} .basic-info {color:var(--zp-secondary);font-size:11px;gap:8px;}}
.center {
  display: flex;
  justify-content: center;
  align-items: center;
}

.item-content {
  position: relative;

  &.video {
    background-color: var(--zp-border);
    border-radius: 8px;
    overflow: hidden;
    width: v-bind('$props.cellWidth + "px"');
    height: var(--card-height);
    cursor: pointer;
    .video-cover { display: block; width: 100%; height: 100%; object-fit: cover; font-size: 0; color: transparent; }
  }

  &.audio {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    border-radius: 8px;
    overflow: hidden;
    width: v-bind('$props.cellWidth + "px"');
    height: var(--card-height);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;

    .audio-icon {
      font-size: 48px;
    }
  }

  .tags-container {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
    width: calc(100% - 16px);
    flex-wrap: wrap-reverse;
    flex-direction: row-reverse;

    &>* {
      margin: 0 0 4px 4px;
      font-size: 14px;
      line-height: 1.6;
    }
  }
}

.close-icon {
  position: absolute;
  top: 0;
  right: 0;
  transform: translate(50%, -50%) scale(1.5);
  cursor: pointer;
  z-index: 100;
  border-radius: 100%;
  overflow: hidden;
  line-height: 1;
  background-color: var(--zp-primary-background);
}

.file {
  padding: 8px 16px;
  margin: 8px;
  display: flex;
  align-items: center;
  background: var(--zp-primary-background);
  border-radius: 8px;
  box-shadow: 0 0 4px var(--zp-secondary-variant-background);
  position: relative;

  &:hover .more {
    opacity: 1;
  }

  .more {
    opacity: 0;
    transition: all 0.3s ease;
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    line-height: 1em;

    .float-btn-wrap {
      font-size: 1.5em;
      cursor: pointer;
      font-weight: 500;
      padding: 4px;
      border-radius: 100vh;
      color: white;
      background: var(--zp-icon-bg);

      margin-bottom: 4px;

      &.like-selected {
        color: rgb(223, 5, 5);
      }
    }
  }

  &.grid {
    padding: 0;
    display: inline-block;
    box-sizing: border-box;
    box-shadow: unset;

    background-color: var(--zp-secondary-background);

    :deep() {
      .icon {
        font-size: 8em;
      }

      .profile {
        padding: 0 4px;

        .name {
          font-weight: 500;
          padding: 0;
        }

        .basic-info {
          display: flex;
          justify-content: space-between;
          flex-direction: row;
          margin: 0;
          font-size: 0.7em;
          * {
            white-space: nowrap;
            overflow: hidden;
          }
        }
      }

      .ant-image,
      .preview-icon-wrap {
        border: 1px solid var(--zp-secondary);
        background-color: var(--zp-secondary-variant-background);
        border-radius: 8px;
        overflow: hidden;
      }

      .ant-image img,
      .dir-cover-container,
      .preview-icon-wrap>[role='img'] {
        height: var(--card-height);
        width: 100%;
        object-fit: cover;
      }
    }
  }

  &.clickable {
    cursor: pointer;
  }

  &.selected {
    outline: #0084ff solid 2px;
  }

  .name {
    flex: 1;
    padding: 8px;
    word-break: break-all;
  }

  .basic-info {
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .dir-cover-container {
    top: 0;
    display: flex;
    flex-wrap: wrap;
    padding: 4px;

    &>img {
      width: calc(50% - 8px);
      height: calc(50% - 8px);
      margin: 4px;
      object-fit: cover;
      border-radius: 8px;
      overflow: hidden
    }
  }
}

.file.grid{width:v-bind('$props.cellWidth + "px"');height:var(--card-height);overflow:hidden;border:1px solid var(--zp-border);border-radius:9px;}
li.grid .profile{height:44px;padding:5px 4px 3px;line-height:18px;min-width:0;}
li.grid .profile .name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:18px;font-size:13px;}
li.grid .profile .basic-info{line-height:16px;font-size:11px;align-items:center;gap:6px;}
li.grid .profile .basic-info>div{min-width:0;text-overflow:ellipsis;}
li.grid .profile .basic-info>div:last-child{flex-shrink:0;}

</style>

<style scoped>
.file .more { flex-direction:row; gap:4px; top:6px; right:6px; }
.file .more .float-btn-wrap { width:26px; height:26px; padding:0; margin:0; display:grid; place-items:center; font-size:15px; border-radius:6px; background:rgba(20,25,32,.65); }
.file .selection-marker { z-index:101; width:20px; height:20px; left:7px; top:9px; padding:0; font-size:13px; line-height:18px; cursor:pointer; }
.file .more:focus-within { opacity:1; }
.file .selection-marker:focus-visible, .file .more button:focus-visible, .file .media-play-trigger:focus-visible { outline:2px solid #1677ff; outline-offset:2px; }
.file .media-play-trigger{position:absolute;top:50%;left:50%;z-index:4;transform:translate(-50%,-50%);width:48px;height:48px;display:grid;place-items:center;padding:0;border:1px solid #fff7;border-radius:50%;background:#111a;box-shadow:0 2px 12px #0008;cursor:pointer;backdrop-filter:blur(4px);transition:background .15s,transform .15s;}
.file .media-play-trigger:hover{background:#111e;transform:translate(-50%,-50%) scale(1.08);}
.file .media-play-trigger img{width:36px;height:36px;display:block;}
.file :deep(.ant-image-mask-info) { font-size:13px; }
@media (hover:none) { .file .more { opacity:1; } }
</style>

<style scoped>.file{user-select:none;}</style>

<style scoped>
.file .card-caption{position:absolute;bottom:0;left:0;right:0;height:44px;padding:19px 9px 8px;box-sizing:border-box;display:flex;align-items:flex-end;gap:4px;overflow:hidden;white-space:nowrap;font-size:12px;font-weight:500;line-height:17px;color:white;text-shadow:0 1px 3px #0009;background:linear-gradient(transparent,#000c);pointer-events:none;z-index:3;}
.file .caption-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.file .compact-tag-summary{display:inline-flex;align-items:center;gap:3px;flex:none;max-width:62%;min-width:0;padding:1px 5px;border-radius:4px;color:#fff;font-size:10px;line-height:16px;text-shadow:0 1px 2px #0008;overflow:hidden;}
.file .compact-tag-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.file .compact-tag-more{flex:none;}
.file.grid .tags-container{bottom:28px;z-index:3;max-height:48px;height:auto;align-items:flex-start;flex-wrap:wrap-reverse;overflow:hidden;}
.file.grid .tags-container :deep(.ant-tag){flex:0 1 auto;min-width:0;max-width:var(--card-tag-max-width);margin:0 0 4px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:20px;}
.file.grid .tags-container .more-tags{flex-shrink:0;margin:0 0 4px 4px;padding:1px 5px;border-radius:4px;background:#111a;color:white;font-size:11px;line-height:18px;}
.file.grid::after{content:none;}
.file.grid > div,.file.grid .item-content,.file.grid :deep(.ant-image),.file.grid :deep(.ant-image-img),.file.grid .preview-icon-wrap{width:100%;height:100%;}
.file.grid .item-content,.file.grid .preview-icon-wrap{border-radius:0;overflow:hidden;}
.file.grid :deep(.ant-image),.file.grid .preview-icon-wrap{display:block;border:0;}
.file.grid :deep(.ant-image-img){display:block;object-fit:cover;}
.file.grid{border-radius:var(--ui-radius);transition:border-color var(--ui-motion-fast) var(--ui-ease),box-shadow var(--ui-motion-fast) var(--ui-ease);}
.file.grid:hover,.file.grid:focus-within{border-color:var(--primary-color-3);box-shadow:0 5px 18px #102c4f29;}
.file .selection-marker{border-radius:5px;box-shadow:0 1px 4px #0003;}
.file .card-caption{height:48px;padding:21px 10px 9px;}
.file .compact-tag-summary{border-radius:5px;}
</style>
