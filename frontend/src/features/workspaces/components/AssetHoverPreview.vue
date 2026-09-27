<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from 'vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import { toImageThumbnailUrl } from '@/features/media-library/public'
import { fileDisplayName } from '@/shared/lib/fileDisplayName'
import WorkspaceSourceBadge from '@/features/workspaces/components/WorkspaceSourceBadge.vue'

interface Preview {
  file: FileNodeInfo
  name: string
  role: string
}
const preview = shallowRef<(Preview & { left: number; top: number }) | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
const WIDTH = 196,
  HEIGHT = 238,
  GAP = 8,
  MARGIN = 12

function hide() {
  clearTimeout(timer)
  timer = undefined
  preview.value = null
  window.removeEventListener('scroll', hide, true)
  window.removeEventListener('wheel', hide, true)
  window.removeEventListener('resize', hide)
  window.removeEventListener('pointerdown', hide, true)
  window.removeEventListener('keydown', hide, true)
}

function show(value: Preview, event: MouseEvent | FocusEvent) {
  hide()
  const anchor = event.currentTarget as HTMLElement
  window.addEventListener('scroll', hide, { capture: true, passive: true })
  window.addEventListener('wheel', hide, { capture: true, passive: true })
  window.addEventListener('resize', hide)
  window.addEventListener('pointerdown', hide, true)
  window.addEventListener('keydown', hide, true)
  timer = setTimeout(() => {
    timer = undefined
    if (!anchor.isConnected) {
      hide()
      return
    }
    const rect = anchor.getBoundingClientRect()
    const left = Math.max(
      MARGIN,
      Math.min(window.innerWidth - WIDTH - MARGIN, rect.left + (rect.width - WIDTH) / 2)
    )
    const below = rect.bottom + GAP
    const top = Math.max(
      MARGIN,
      Math.min(
        window.innerHeight - HEIGHT - MARGIN,
        below + HEIGHT <= window.innerHeight - MARGIN ? below : rect.top - HEIGHT - GAP
      )
    )
    preview.value = { ...value, left, top }
  }, 200)
}

defineExpose({ show, hide })
onBeforeUnmount(hide)
</script>

<template>
  <Teleport to="body">
    <Transition name="asset-hover">
      <div
        v-if="preview"
        class="asset-hover-preview"
        :class="{ 'workspace-created': preview.file.workspace_artifact_id }"
        :style="{ left: `${preview.left}px`, top: `${preview.top}px` }"
        aria-hidden="true"
      >
        <div class="hover-thumbnail">
          <img :src="toImageThumbnailUrl(preview.file, '256x256')" alt="" />
          <small v-if="preview.role" class="hover-role">{{ preview.role }}</small>
          <WorkspaceSourceBadge
            v-if="preview.file.workspace_artifact_id"
            :source="preview.file.workspace_artifact_source"
          />
        </div>
        <div class="hover-name">{{ fileDisplayName(preview.name) }}</div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.asset-hover-preview {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  width: 196px;
  height: 238px;
  padding: 6px;
  border: 2px solid color-mix(in srgb, var(--primary-color) 55%, var(--ui-border));
  border-radius: 12px;
  background: var(--ui-surface);
  color: var(--ui-text);
  box-shadow: 0 8px 24px #182d4930;
  pointer-events: none;
}
.asset-hover-preview.workspace-created {
  border-color: #e7cf88;
  background: color-mix(in srgb, #fff0b8 35%, var(--ui-surface));
}
.hover-thumbnail {
  position: relative;
  width: 180px;
  height: 180px;
  border-radius: 7px;
  overflow: hidden;
  background: var(--ui-surface-soft);
}
.hover-thumbnail img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.hover-role {
  position: absolute;
  top: 3px;
  left: 3px;
  padding: 1px 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ui-surface) 94%, transparent);
  color: var(--primary-color);
  box-shadow: 0 1px 4px #0003;
  font-size: 10px;
  line-height: 16px;
}
.hover-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  margin-top: 6px;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}
.asset-hover-enter-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}
.asset-hover-leave-active {
  transition: opacity 0.1s ease;
}
.asset-hover-enter-from {
  opacity: 0;
  transform: scale(0.94);
}
.asset-hover-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .asset-hover-enter-active,
  .asset-hover-leave-active {
    transition: none;
  }
}
</style>
