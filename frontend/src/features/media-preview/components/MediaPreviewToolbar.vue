<script setup lang="ts">
import { ref } from 'vue'
import {
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  DownloadOutlined,
  CommentOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons-vue'
import {
  CloseOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  HeartOutlined,
  HeartFilled
} from '@/shared/icons/index'

export type PreviewToolbarAction =
  | 'fullscreen'
  | 'like'
  | 'download'
  | 'edit'
  | 'reset'
  | 'rotate-left'
  | 'rotate-right'
  | 'description'
  | 'details'
  | 'mute'
  | 'delete'
  | 'close'

defineProps<{
  visible: boolean
  fullscreen: boolean
  hasLikeTag: boolean
  liked: boolean
  isImage: boolean
  canEditImage: boolean
  muted: boolean
  editing?: boolean
  saving?: boolean
  descriptionVisible: boolean
  detailsOpen: boolean
  showDelete: boolean
  deleteDisabled: boolean
}>()
const emit = defineEmits<{ action: [action: PreviewToolbarAction] }>()
const detailsButton = ref<HTMLButtonElement>()
defineExpose({ focusDetails: () => detailsButton.value?.focus({ preventScroll: true }) })
</script>

<template>
  <div v-show="visible" class="preview-controls">
    <div class="viewer-controls-bar" role="toolbar" aria-label="预览操作">
      <div class="control-group" role="group" aria-label="常用操作">
        <button
          type="button"
          class="control-btn fullscreen-btn"
          @click="emit('action', 'fullscreen')"
          :title="fullscreen ? $t('exitFullscreen') : $t('fullscreen')"
          :aria-label="fullscreen ? $t('exitFullscreen') : $t('fullscreen')"
        >
          <FullscreenExitOutlined v-if="fullscreen" />
          <FullscreenOutlined v-else />
        </button>
        <button
          v-if="hasLikeTag"
          type="button"
          class="control-btn like-btn"
          :disabled="editing"
          :class="{ 'like-active': liked }"
          @click="emit('action', 'like')"
          :title="liked ? $t('unlike') : $t('like')"
          :aria-label="liked ? $t('unlike') : $t('like')"
        >
          <HeartFilled v-if="liked" />
          <HeartOutlined v-else />
        </button>
      </div>
      <div v-if="isImage" class="control-group" role="group" aria-label="图片操作">
        <button
          type="button"
          class="control-btn"
          :disabled="!canEditImage || saving"
          :class="{ 'crop-active': editing }"
          :aria-pressed="!!editing"
          title="调整图片"
          aria-label="调整图片"
          @click="emit('action', 'edit')"
        >
          <EditOutlined />
        </button>
      </div>
      <div class="control-group" role="group" aria-label="媒体信息">
        <button
          type="button"
          class="control-btn description-btn"
          :disabled="editing"
          :class="{ 'description-active': descriptionVisible }"
          :title="descriptionVisible ? '隐藏媒体描述' : '显示媒体描述'"
          :aria-label="descriptionVisible ? '隐藏媒体描述' : '显示媒体描述'"
          :aria-pressed="descriptionVisible"
          @click="emit('action', 'description')"
        >
          <CommentOutlined />
        </button>
        <button
          ref="detailsButton"
          type="button"
          class="control-btn details-btn"
          :disabled="editing"
          :class="{ 'details-active': detailsOpen }"
          :title="detailsOpen ? '收起详细信息' : '展开详细信息'"
          :aria-label="detailsOpen ? '收起详细信息' : '展开详细信息'"
          aria-controls="preview-details"
          :aria-expanded="detailsOpen"
          :aria-pressed="detailsOpen"
          @click="emit('action', 'details')"
        >
          <ExclamationCircleOutlined />
        </button>
      </div>
      <div class="control-group" role="group" aria-label="删除与关闭">
        <a-dropdown :trigger="['click']" placement="bottomRight">
          <button
            type="button"
            class="control-btn"
            :disabled="editing"
            title="更多操作"
            aria-label="更多操作"
          >
            <MoreOutlined />
          </button>
          <template #overlay
            ><a-menu>
              <a-menu-item @click="emit('action', 'download')"
                ><DownloadOutlined /> 下载原文件</a-menu-item
              >
              <a-menu-item
                v-if="showDelete"
                danger
                :disabled="deleteDisabled"
                @click="emit('action', 'delete')"
                ><DeleteOutlined /> 删除当前文件</a-menu-item
              >
            </a-menu></template
          >
        </a-dropdown>
        <button
          type="button"
          class="control-btn close-btn"
          :disabled="saving"
          @click="emit('action', 'close')"
          :title="editing ? '返回预览' : '关闭预览（Esc）'"
          :aria-label="editing ? '返回预览' : '关闭预览'"
        >
          <CloseOutlined />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-controls {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 10;
}
.control-btn {
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: #fff3;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  backdrop-filter: blur(10px);
  transition:
    background 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}
.control-btn:hover:not(:disabled) {
  background: #ffffff4d;
  transform: scale(1.1);
}
.control-btn:active:not(:disabled) {
  transform: scale(0.95);
}
.control-btn.like-active {
  background: #ff14934d;
  color: #ff1493;
}
.control-btn.like-active:hover {
  background: #ff149380;
}
.control-btn.like-btn:not(.like-active):hover {
  color: #ff69b4;
}
.viewer-controls-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  align-self: flex-end;
  gap: 4px;
  max-width: 100%;
  padding: 4px;
  border: 1px solid #ffffff24;
  border-radius: 10px;
  background: #1c1f24db;
  box-shadow: 0 6px 22px #0005;
  backdrop-filter: blur(14px);
}
.control-group {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}
.control-group + .control-group {
  border-left: 1px solid #ffffff26;
  padding-left: 4px;
}
.viewer-controls-bar .control-btn {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  padding: 0;
  border-radius: 6px;
  background: transparent;
  color: #f2f3f5;
  font-size: 15px;
}
.viewer-controls-bar .control-btn:hover:not(:disabled) {
  background: #ffffff25;
  transform: none;
}
.viewer-controls-bar .control-btn:active:not(:disabled) {
  transform: none;
  background: #ffffff35;
}
.viewer-controls-bar .control-btn:focus-visible {
  outline: 2px solid #89bfff;
  outline-offset: 1px;
}
.viewer-controls-bar .control-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.viewer-controls-bar .control-btn.like-active {
  color: #ff6b9d;
  background: #ff6b9d24;
}
.viewer-controls-bar .control-btn.delete-btn {
  color: #ff9995;
}
.viewer-controls-bar .control-btn.crop-active,
.viewer-controls-bar .control-btn.details-active,
.viewer-controls-bar .control-btn.description-active {
  color: #9fc9ff;
  background: #6caeff26;
}
@media (max-width: 768px) {
  .preview-controls {
    top: 40px;
    right: 15px;
    gap: 10px;
  }
}
@media (max-width: 600px) {
  .viewer-controls-bar {
    gap: 3px;
    padding: 3px;
  }
  .control-group {
    gap: 1px;
  }
  .control-group + .control-group {
    padding-left: 3px;
  }
  .viewer-controls-bar .control-btn {
    width: 26px;
    height: 26px;
    font-size: 13px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .control-btn {
    transition: none;
  }
}
</style>
