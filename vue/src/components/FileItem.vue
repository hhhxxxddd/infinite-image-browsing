<script setup lang="ts">
import { tagLabel } from '@/util/tagLabel'
import { FileOutlined, FolderOpenOutlined, EllipsisOutlined, HeartOutlined, HeartFilled } from '@/icon'
import { useGlobalStore } from '@/store/useGlobalStore'
import { fallbackImage, ok } from 'vue3-ts-util'
import type { FileNodeInfo } from '@/api/files'
import { isImageFile, isVideoFile, isAudioFile } from '@/util'
import { toImageThumbnailUrl, toVideoCoverUrl, toRawFileUrl } from '@/util/file'
import type { MenuInfo } from 'ant-design-vue/lib/menu/src/interface'
import { computed, ref, nextTick, watch, onBeforeUnmount, inject } from 'vue'
import ContextMenu from './ContextMenu.vue'
import TagMenuItems from './TagMenuItems.vue'
import ChangeIndicator from './ChangeIndicator.vue'
import { useTagStore } from '@/store/useTagStore'
import { CloseCircleOutlined } from '@/icon'
import { Tag } from '@/api/db'
import type { GenDiffInfo } from '@/api/files'
import { play } from '@/icon'
import { Top4MediaInfo } from '@/api'
import { debounce } from 'lodash-es'
import { mediaPreviewKey } from '@/util/mediaPreviewContext'
import { cardThumbnailShortEdge, mediaCardHeight } from '@/util/mediaCardLayout'
import { openTiktokViewWithFiles } from '@/util/tiktokHelper'
import { eventEmitter as videoEventEmitter, useEventListen } from './videoEventEmitter'
import { useI18n } from 'vue-i18n'
import { ExportOutlined } from '@ant-design/icons-vue'
import { startDrag } from '@crabnebula/tauri-plugin-drag'
import { isTauri } from '@/util/env'
import dragIcon from '../../src-tauri/icons/32x32.png?inline'
import { message } from 'ant-design-vue'
import { invoke } from '@tauri-apps/api/core'

const { t } = useI18n()

const global = useGlobalStore()
const tagStore = useTagStore()
const previewMedia = inject(mediaPreviewKey, undefined)
function openMedia() {
  if (previewMedia) previewMedia(props.idx)
  else openTiktokViewWithFiles([props.file], 0)
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
    enableChangeIndicator?: boolean
    extraTags?: Tag[]
    coverFiles?: Top4MediaInfo[]
    getGenDiff?: (ownGenInfo: any, idx: any, increment: any, ownFile: FileNodeInfo) => GenDiffInfo,
    getGenDiffWatchDep?: (idx: number) => any
  }>(),
  {
    selected: false, enableRightClickMenu: true, enableCloseIcon: false
  }
)

const genDiffToPrevious = ref<GenDiffInfo>()
const calcGenInfoDiff = debounce(() => {
  const { getGenDiff, file, idx } = props
  if (!getGenDiff) return
  genDiffToPrevious.value = getGenDiff(file.gen_info_obj, idx, -1, file)
}, 200 + 100 * Math.random())

watch(() => props.getGenDiffWatchDep?.(props.idx), () => {
  calcGenInfoDiff()
}, { immediate: true, deep: true })

const emit = defineEmits<{
  'update:showMenuIdx': [v: number],
  'fileItemClick': [event: MouseEvent, file: FileNodeInfo, idx: number],
  'dragstart': [event: DragEvent, idx: number],
  'dragend': [event: DragEvent, idx: number],
  'dropToFolder': [event: DragEvent, file: FileNodeInfo, idx: number],
  'contextMenuClick': [e: MenuInfo, file: FileNodeInfo, idx: number],
  'close-icon-click': [],
  'tiktokView': [file: FileNodeInfo, idx: number],
  'imageDimensions': [path: string, width: number, height: number]
}>()

const customTags = computed(() => {
  return tagStore.tagMap.get(props.file.fullpath) ?? []
})
const cardTags = computed(() => props.extraTags ?? customTags.value)
const cardTagColumns = computed(() => props.cellWidth >= 220 ? 3 : 2)
const cardHeight = computed(() => props.displayHeight ?? mediaCardHeight(props.cellWidth))
const cardTagRows = computed(() => cardHeight.value >= 150 ? 2 : cardHeight.value >= 90 ? 1 : 0)
const cardTagCapacity = computed(() => cardTagColumns.value * cardTagRows.value)
const visibleCardTags = computed(() => cardTags.value.slice(0,
  cardTags.value.length > cardTagCapacity.value ? Math.max(0, cardTagCapacity.value - 1) : cardTagCapacity.value))
const hiddenCardTagCount = computed(() => cardTags.value.length - visibleCardTags.value.length)
const cardTagStyle = computed(() => ({
  '--card-tag-max-width': `${Math.floor((props.cellWidth - 20 - cardTagColumns.value * 4) / cardTagColumns.value)}px`
}))

const imageSrc = computed(() => {
  // Use a few cache-friendly short-edge sizes near the card's display size.
  const r = cardThumbnailShortEdge(Math.min(props.cellWidth, cardHeight.value), window.devicePixelRatio || 1, global.gridThumbnailResolution)
  return global.enableThumbnail ? toImageThumbnailUrl(props.file, [r, r].join('x'), 'short') : toRawFileUrl(props.file)
})

const imageContainerRef = ref<HTMLElement | null>(null)
const isImageNearViewport = ref(false)
const lazyImageSrc = computed(() => isImageNearViewport.value ? imageSrc.value : undefined)
let imageObserver: IntersectionObserver | undefined

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

// 视频原地播放相关
const isPlayingInline = ref(false)
const videoElementRef = ref<HTMLVideoElement | null>(null)

// 切换原地播放
const toggleInlinePlay = (event: MouseEvent) => {
  console.log('toggleInlinePlay', { event, isPlayingInline: isPlayingInline.value, videoRef: videoElementRef.value })
  event.stopPropagation()

  // 如果要开始播放，先通知其他视频停止
  if (!isPlayingInline.value) {
    videoEventEmitter.emit('stopInlinePlay')
  }

  // 先切换状态，让video元素渲染出来
  isPlayingInline.value = !isPlayingInline.value

  // 使用 nextTick 确保 video 元素已经渲染
  if (!isPlayingInline.value) {
    // 如果是暂停，直接暂停
    if (videoElementRef.value) {
      videoElementRef.value.pause()
    }
  } else {
    // 如果是播放，等待DOM更新后再播放
    nextTick(() => {
      if (videoElementRef.value) {
        console.log('Playing video', videoElementRef.value)
        videoElementRef.value.play().catch(err => {
          console.error('Play failed:', err)
          isPlayingInline.value = false
        })
      } else {
        console.error('Video ref is null after nextTick')
        isPlayingInline.value = false
      }
    })
  }
}

// 处理其他视频播放的通知
const handleStopInlinePlay = () => {
  if (isPlayingInline.value && videoElementRef.value) {
    videoElementRef.value.pause()
    isPlayingInline.value = false
  }
}

// 监听停止事件
useEventListen('stopInlinePlay', handleStopInlinePlay)

// 视频播放结束处理
const handleVideoEnded = () => {
  isPlayingInline.value = false
}

// 判断是否显示原地播放按钮（宽度大于400且未在播放）
const shouldShowInlinePlayBtn = computed(() => {
  return props.cellWidth > 400 && !isPlayingInline.value
})

// 监听 idx 变化，如果正在播放则停止
watch(() => props.idx, () => {
  if (isPlayingInline.value && videoElementRef.value) {
    videoElementRef.value.pause()
    isPlayingInline.value = false
  }
})

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
const isCardControl = (event: MouseEvent) => !!(event.target as HTMLElement).closest('.more, .selection-marker, .close-icon')
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
          <a-dropdown :trigger="['click']">
            <button class="float-btn-wrap" title="文件操作" aria-label="文件操作">
              <ellipsis-outlined />
            </button>
            <template #overlay>
              <context-menu :file="file" :idx="idx" :selected-tag="customTags"
                @context-menu-click="(e, f, i) => emit('contextMenuClick', e, f, i)"
                :is-selected-mutil-files="selected && isSelectedMutilFiles" />
            </template>
          </a-dropdown>
          <a-dropdown v-if="file.type === 'file'">
            <button class="float-btn-wrap" :class="{ 'like-selected': likeTag?.selected }" :title="likeTag?.selected ? '取消收藏' : '收藏'" :aria-label="likeTag?.selected ? '取消收藏' : '收藏'" @click="taggleLikeTag">
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
          <div class="tags-container" v-if="cardTags.length && cardTagRows && cellWidth > minShowDetailWidth" :style="cardTagStyle" :title="cardTags.map(tagLabel).join('、')">
            <a-tag v-for="tag in visibleCardTags" :key="tag.id" :color="tagStore.getColor(tag)">
              {{ tagLabel(tag) }}
            </a-tag>
            <span v-if="hiddenCardTagCount" class="more-tags">+{{ hiddenCardTagCount }}</span>
          </div>
        </div>
        <div :class="[`idx-${idx} item-content video`, { 'playing-inline': isPlayingInline }]" :url="toVideoCoverUrl(file)"
          :style="{ 'background-image': isPlayingInline ? 'none' : `url('${file.cover_url ?? toVideoCoverUrl(file)}')` }" v-else-if="isVideoFile(file.name)"
          role="button" tabindex="0" :aria-label="'播放视频：' + file.name" @keydown.enter.prevent="handleVideoClick" @keydown.space.prevent="handleVideoClick" @click="handleVideoClick">

          <!-- 原地播放视频元素 -->
          <video
            v-if="cellWidth > 400 && isPlayingInline"
            :ref="(el) => videoElementRef = el as HTMLVideoElement"
            :src="toRawFileUrl(file)"
            class="inline-video-player"
            @ended="handleVideoEnded"
            @click.stop
            controls
          />

          <!-- 遮罩层和原地播放按钮 -->
          <div v-if="shouldShowInlinePlayBtn" class="inline-play-overlay" @click="toggleInlinePlay">
            <div class="inline-play-btn">
              <img :src="play" class="play-icon-img">
              <span class="play-text">{{ t('playInline') }}</span>
            </div>
          </div>

          <!-- 原有的中心播放图标（用于打开modal） -->
          <div class="play-icon" v-show="!isPlayingInline">
            <img :src="play" style="width: 40px;height: 40px;">
          </div>
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
          <span v-if="cardTags.length && !cardTagRows && cellWidth > minShowDetailWidth" class="compact-tag-count" :title="cardTags.map(tagLabel).join('、')"><i :style="{ backgroundColor: tagStore.getColor(cardTags[0]) }" />+{{ cardTags.length }}</span>
          <ChangeIndicator v-if="file.type === 'file' && enableChangeIndicator && genDiffToPrevious"
            :gen-diff-to-previous="genDiffToPrevious" />
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
    background-size: cover;
    background-position: center;
    cursor: pointer;

    &.playing-inline {
      background-color: #000;
    }

    .inline-video-player {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .inline-play-overlay {
      position: absolute;
      bottom: 8px;
      left: 8px;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.3s ease;
      z-index: 5;
    }

    .inline-play-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-radius: 8px;
      background: linear-gradient(135deg, rgba(0, 0, 0, 0.85) 0%, rgba(20, 20, 20, 0.9) 100%);
      backdrop-filter: blur(8px);
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.3),
        0 0 0 1px rgba(0, 0, 0, 0.1) inset,
        0 1px 0 rgba(255, 255, 255, 0.1) inset;

      &:hover {
        background: linear-gradient(135deg, rgba(0, 0, 0, 0.95) 0%, rgba(30, 30, 30, 0.95) 100%);
        border-color: rgba(255, 255, 255, 0.25);
        transform: translateY(-1px);
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(0, 0, 0, 0.1) inset,
          0 1px 0 rgba(255, 255, 255, 0.15) inset;
      }

      &:active {
        transform: translateY(0);
        background: rgba(0, 0, 0, 0.95);
      }

      .play-icon-img {
        width: 24px;
        height: 24px;
        filter: brightness(0) invert(1);
        flex-shrink: 0;
      }

      .play-text {
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.2px;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        white-space: nowrap;
      }
    }

    &:hover .inline-play-overlay {
      opacity: 1;
    }
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

  .play-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    border-radius: 100%;
    display: flex;
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
.file .selection-marker:focus-visible, .file .more button:focus-visible { outline:2px solid #1677ff; outline-offset:2px; }
.file :deep(.ant-image-mask-info) { font-size:13px; }
@media (hover:none) { .file .more { opacity:1; } }
</style>

<style scoped>.file{user-select:none;}</style>

<style scoped>
.file .card-caption{position:absolute;bottom:0;left:0;right:0;height:44px;padding:19px 9px 8px;box-sizing:border-box;display:flex;align-items:flex-end;gap:4px;overflow:hidden;white-space:nowrap;font-size:12px;font-weight:500;line-height:17px;color:white;text-shadow:0 1px 3px #0009;background:linear-gradient(transparent,#000c);pointer-events:none;z-index:3;}
.file .caption-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.file .compact-tag-count{flex:none;padding:0 4px;border-radius:4px;background:#111a;font-size:10px;pointer-events:auto;}
.file .compact-tag-count i{display:inline-block;width:6px;height:6px;margin-right:3px;border-radius:50%;vertical-align:1px;}
.file.grid .tags-container{bottom:28px;z-index:3;max-height:48px;height:auto;align-items:flex-start;flex-wrap:wrap-reverse;overflow:hidden;}
.file.grid .tags-container :deep(.ant-tag){flex:0 1 auto;min-width:0;max-width:var(--card-tag-max-width);margin:0 0 4px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:20px;}
.file.grid .tags-container .more-tags{flex-shrink:0;margin:0 0 4px 4px;padding:1px 5px;border-radius:4px;background:#111a;color:white;font-size:11px;line-height:18px;}
.file.grid::after{content:none;}
.file.grid > div,.file.grid .item-content,.file.grid :deep(.ant-image),.file.grid :deep(.ant-image-img),.file.grid .preview-icon-wrap{width:100%;height:100%;}
.file.grid .item-content,.file.grid .preview-icon-wrap{border-radius:0;overflow:hidden;}
.file.grid :deep(.ant-image),.file.grid .preview-icon-wrap{display:block;border:0;}
.file.grid :deep(.ant-image-img){display:block;object-fit:cover;}
</style>
