<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApplicationStore } from '@/features/application/public'
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { getMediaRuntime, manageMediaRuntime, type MediaRuntimeStatus } from '../api/mediaRuntime'
import SettingsGroup from './SettingsGroup.vue'

const props = defineProps<{ active: boolean }>()
const global = useApplicationStore()
const state = ref<MediaRuntimeStatus>()
const error = ref('')
const pending = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
let failures = 0
const busy = computed(() => pending.value || !!state.value?.job.running)
const label = computed(() => {
  if (state.value?.job.running) return state.value.job.stage
  if (state.value?.job.error) return '检查未通过'
  if (state.value?.ready) return '可用'
  return '未就绪'
})

function schedule() {
  clearTimeout(timer)
  if (!disposed && props.active && !document.hidden && (state.value?.job.running || error.value))
    timer = setTimeout(refresh, Math.min(30000, 2000 * 2 ** failures))
}

async function refresh() {
  if (pending.value || disposed || !props.active) return
  pending.value = true
  try {
    const next = await getMediaRuntime()
    if (disposed) return
    state.value = next
    error.value = ''
    failures = 0
  } catch (cause) {
    error.value = getErrorMessage(cause, '读取 FFmpeg 状态失败')
    failures = Math.min(failures + 1, 4)
  } finally {
    pending.value = false
    schedule()
  }
}

async function run(action: 'check' | 'install') {
  if (busy.value || global.conf?.is_readonly) return
  pending.value = true
  error.value = ''
  try {
    state.value = await manageMediaRuntime(action)
  } catch (cause) {
    error.value = getErrorMessage(cause, '无法启动 FFmpeg 任务')
  } finally {
    pending.value = false
    schedule()
  }
}

function onVisibility() {
  if (!document.hidden && props.active) void refresh()
  else clearTimeout(timer)
}
watch(
  () => props.active,
  (active) => {
    if (active) void refresh()
    else clearTimeout(timer)
  }
)
onMounted(() => {
  void refresh()
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <SettingsGroup
    title="音视频运行环境 · FFmpeg"
    help="音频制作的试听、混音和导出需要 FFmpeg 与 ffprobe。视频制作接入后也可共用。媒体库播放由浏览器解码。"
    class="media-runtime-card"
  >
    <template #actions>
      <span class="runtime-state" :class="{ ready: state?.ready && !state?.job.error }">{{
        label
      }}</span>
    </template>
    <p v-if="state?.ready">
      当前使用{{ state.source === 'managed' ? '应用管理版本' : '系统版本' }}：FFmpeg
      {{ state.version }}
    </p>
    <p v-else-if="state">
      未找到可用的 ffmpeg 和 ffprobe；音频制作的试听与导出需要先配置运行环境。
    </p>
    <div class="runtime-actions">
      <a-button :disabled="busy || global.conf?.is_readonly" @click="run('check')">
        检查环境
      </a-button>
      <a-button
        v-if="state?.supported"
        type="primary"
        :disabled="busy || global.conf?.is_readonly"
        @click="run('install')"
        >{{
          !state.managed_installed
            ? '安装应用版本'
            : state.update_available
              ? '更新应用版本'
              : '修复／重新安装'
        }}</a-button
      >
    </div>
    <p v-if="state && !state.supported">
      源码模式使用后端进程 PATH 中的工具；更换或安装后请重启后端。
    </p>
    <p v-if="state?.supported && !state.managed_installed">
      应用版本约需下载 110 MB；已可用的系统版本无需安装。
    </p>
    <a-progress
      v-if="state?.job.running"
      :percent="state.job.progress"
      :show-info="false"
      aria-label="FFmpeg 安装阶段进度"
    />
    <p v-if="state?.job.stage" role="status">{{ state.job.stage }}</p>
    <a-alert
      v-if="error || state?.job.error"
      type="error"
      :message="error || state?.job.error"
      show-icon
    />
    <details v-if="state">
      <summary>运行环境详情</summary>
      <p v-if="state.path" class="runtime-path">路径：{{ state.path }}</p>
      <p>ffprobe：{{ state.ffprobe_version || '不可用' }}</p>
      <p v-if="state.supported">应用兼容版本：{{ state.recipe }}</p>
      <p>
        应用版本来自
        <a href="https://www.gyan.dev/ffmpeg/builds/" target="_blank" rel="noopener noreferrer"
          >Gyan FFmpeg builds</a
        >，按 GPLv3 提供。
      </p>
    </details>
  </SettingsGroup>
</template>

<style scoped>
.media-runtime-card :deep(.settings-group-body) {
  padding: 16px 20px;
}
.runtime-state {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--ui-surface-soft);
  color: var(--zp-secondary);
}
.runtime-state.ready {
  color: var(--primary-color);
  background: var(--primary-color-1);
}
.runtime-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
p,
summary {
  margin: 10px 0;
  color: var(--zp-secondary);
  font-size: 12px;
  line-height: 1.7;
}
.runtime-path {
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
}
@container (max-width: 650px) {
  .media-runtime-card :deep(.settings-group-body) {
    padding: 16px;
  }
}
</style>
