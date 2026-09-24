<script setup lang="ts">
import { DeleteOutlined, EditOutlined, RotateLeftOutlined, RotateRightOutlined, DownloadOutlined, BorderOutlined, FileTextOutlined, ToolOutlined } from '@ant-design/icons-vue'
import { CloseOutlined, FullscreenOutlined, FullscreenExitOutlined, SoundOutlined, SoundFilled, HeartOutlined, HeartFilled, PlayCircleOutlined } from '@/icon'

export type PreviewToolbarAction = 'fullscreen' | 'like' | 'download' | 'autoplay' | 'edit' | 'reset' | 'rotate-left' | 'rotate-right' | 'description' | 'mute' | 'delete' | 'close'

defineProps<{
  visible: boolean
  fullscreen: boolean
  hasLikeTag: boolean
  liked: boolean
  autoplayEnabled: boolean
  autoplayTitle: string
  isImage: boolean
  canEditImage: boolean
  muted: boolean
  descriptionVisible: boolean
  deleteDisabled: boolean
}>()
const toolsOpen = defineModel<boolean>('toolsOpen', { required: true })
const emit = defineEmits<{ action: [action: PreviewToolbarAction] }>()

function runImageTool(action: PreviewToolbarAction) {
  toolsOpen.value = false
  emit('action', action)
}
</script>

<template>
  <div v-show="visible" class="preview-controls">
    <div class="viewer-controls-bar" role="toolbar" aria-label="预览操作">
      <button type="button" class="control-btn fullscreen-btn" @click="emit('action', 'fullscreen')"
        :title="fullscreen ? $t('exitFullscreen') : $t('fullscreen')"
        :aria-label="fullscreen ? $t('exitFullscreen') : $t('fullscreen')">
        <FullscreenExitOutlined v-if="fullscreen" />
        <FullscreenOutlined v-else />
      </button>
      <button v-if="hasLikeTag" type="button" class="control-btn like-btn" :class="{ 'like-active': liked }" @click="emit('action', 'like')"
        :title="liked ? $t('unlike') : $t('like')" :aria-label="liked ? $t('unlike') : $t('like')">
        <HeartFilled v-if="liked" />
        <HeartOutlined v-else />
      </button>
      <button type="button" class="control-btn" title="下载原文件" aria-label="下载原文件" @click="emit('action', 'download')"><DownloadOutlined /></button>
      <button type="button" class="control-btn autoplay-btn" :class="{ 'autoplay-active': autoplayEnabled }"
        @click="emit('action', 'autoplay')" :title="autoplayTitle" :aria-label="autoplayTitle" :aria-pressed="autoplayEnabled">
        <PlayCircleOutlined />
      </button>
      <span class="control-divider" aria-hidden="true"></span>
      <a-popover v-if="isImage" v-model:open="toolsOpen" trigger="click" placement="bottomRight" color="#24272d" overlay-class-name="viewer-image-tools-popover">
        <template #content>
          <div class="viewer-image-tools" role="group" aria-label="图片操作" @click.stop>
            <button v-if="canEditImage" type="button" @click="runImageTool('edit')"><EditOutlined />编辑图片</button>
            <button type="button" @click="runImageTool('reset')"><BorderOutlined />适应窗口 <kbd>0</kbd></button>
            <button type="button" @click="runImageTool('rotate-left')"><RotateLeftOutlined />向左旋转</button>
            <button type="button" @click="runImageTool('rotate-right')"><RotateRightOutlined />向右旋转 <kbd>R</kbd></button>
            <button type="button" :aria-pressed="descriptionVisible" @click="runImageTool('description')"><FileTextOutlined />{{ descriptionVisible ? '隐藏图上描述' : '显示图上描述' }}</button>
          </div>
        </template>
        <button type="button" class="control-btn" title="图片工具" aria-label="图片工具" aria-haspopup="true" :aria-expanded="toolsOpen"><ToolOutlined /></button>
      </a-popover>
      <button v-else type="button" class="control-btn sound-btn" @click="emit('action', 'mute')" :title="muted ? $t('soundOn') : $t('soundOff')" :aria-label="muted ? '开启声音' : '静音'"><SoundFilled v-if="!muted" /><SoundOutlined v-else /></button>
      <span class="control-divider" aria-hidden="true"></span>
      <button type="button" class="control-btn delete-btn" title="删除当前文件" aria-label="删除当前文件" :disabled="deleteDisabled" @click="emit('action', 'delete')"><DeleteOutlined /></button>
      <button type="button" class="control-btn close-btn" @click="emit('action', 'close')" title="关闭预览（Esc）" aria-label="关闭预览"><CloseOutlined /></button>
    </div>
  </div>
</template>

<style scoped>
.preview-controls{position:absolute;top:20px;right:20px;display:flex;flex-direction:column;gap:12px;z-index:10;}
.control-btn{width:44px;height:44px;border:0;border-radius:50%;background:#fff3;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;backdrop-filter:blur(10px);transition:background .15s ease,color .15s ease,transform .15s ease;}
.control-btn:hover{background:#ffffff4d;transform:scale(1.1);}.control-btn:active{transform:scale(.95);}
.control-btn.like-active{background:#ff14934d;color:#ff1493;}.control-btn.like-active:hover{background:#ff149380;}.control-btn.like-btn:not(.like-active):hover{color:#ff69b4;}
.control-btn.autoplay-btn{width:48px;height:48px;font-size:20px;}.control-btn.autoplay-active{background:#4caf504d;color:#4caf50;}.control-btn.autoplay-btn:not(.autoplay-active):hover{color:#81c784;}
.viewer-controls-bar{display:flex;align-items:center;gap:3px;max-width:100%;padding:4px;border:1px solid #ffffff24;border-radius:10px;background:#1c1f24db;box-shadow:0 6px 22px #0005;backdrop-filter:blur(14px);}
.viewer-controls-bar .control-btn,.viewer-controls-bar .control-btn.autoplay-btn{width:32px;height:32px;flex-shrink:0;padding:0;border-radius:6px;background:transparent;color:#f2f3f5;font-size:15px;}
.viewer-controls-bar .control-btn:hover,.viewer-controls-bar .control-btn.autoplay-btn:hover{background:#ffffff25;transform:none;}
.viewer-controls-bar .control-btn:active{transform:none;background:#ffffff35;}.viewer-controls-bar .control-btn:focus-visible{outline:2px solid #89bfff;outline-offset:1px;}.viewer-controls-bar .control-btn:disabled{opacity:.4;cursor:not-allowed;}
.viewer-controls-bar .control-btn.like-active{color:#ff6b9d;background:#ff6b9d24;}.viewer-controls-bar .control-btn.autoplay-active{color:#9fdfb1;background:#4caf5030;}.viewer-controls-bar .control-btn.delete-btn{color:#ff9995;}
.control-divider{width:1px;height:18px;flex-shrink:0;margin:0 2px;background:#ffffff34;}
.viewer-image-tools{display:flex;flex-direction:column;min-width:164px;padding:2px;color:#f2f3f5;}.viewer-image-tools button{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:5px;background:none;color:inherit;text-align:left;font:inherit;font-size:12px;cursor:pointer;}.viewer-image-tools button:hover,.viewer-image-tools button:focus-visible{background:#ffffff24;outline:none;}.viewer-image-tools button[aria-pressed="true"]{color:#9fc9ff;}.viewer-image-tools .anticon{font-size:14px;}.viewer-image-tools kbd{margin-left:auto;color:#acb6c4;font:11px ui-monospace,monospace;}
@media(max-width:768px){.preview-controls{top:40px;right:15px;gap:10px;}}
@media(max-width:600px){.viewer-controls-bar{gap:1px;padding:3px;}.viewer-controls-bar .control-btn,.viewer-controls-bar .control-btn.autoplay-btn{width:26px;height:26px;font-size:13px;}.control-divider{margin:0 1px;}}
@media(prefers-reduced-motion:reduce){.control-btn{transition:none;}}
</style>
