<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  getDesktopRuntime,
  manageDesktopRuntime,
  type DesktopRuntimeStatus,
  type RuntimeVariant
} from '@/features/ai-workflows/public'
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { useApplicationStore } from '@/features/application/public'
import SettingsGroup from './SettingsGroup.vue'

const props = defineProps<{ active: boolean }>()
const global = useApplicationStore()
const state = ref<DesktopRuntimeStatus>()
const variant = ref<RuntimeVariant>('cu128')
const error = ref('')
const pending = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
let failures = 0
const busy = computed(() => pending.value || !!state.value?.job.running)
const label = computed(() =>
  state.value?.job.running
    ? state.value.job.stage
    : state.value?.check.ready
      ? '本地就绪'
      : state.value?.installed
        ? '需要检查／修复'
        : '未安装'
)

function schedule() {
  clearTimeout(timer)
  if (!disposed && props.active && !document.hidden && (state.value?.job.running || error.value))
    timer = setTimeout(refresh, Math.min(30000, 2000 * 2 ** failures))
}

async function refresh() {
  if (pending.value || disposed || !props.active) return
  pending.value = true
  try {
    const next = await getDesktopRuntime()
    if (disposed) return
    if (!state.value || state.value.job.running) variant.value = next.variant
    state.value = next
    error.value = ''
    failures = 0
  } catch (cause) {
    error.value = getErrorMessage(cause, '读取运行环境失败')
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
    state.value = await manageDesktopRuntime(action, variant.value)
  } catch (cause) {
    error.value = getErrorMessage(cause, '无法启动运行环境任务')
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
  <div class="runtime-container">
    <SettingsGroup
      title="本地 AI 运行环境 · PyTorch"
      :help="
        state?.supported
          ? '图文检索、图片重排和内容处理共用。安装应用支持的依赖版本，不改动系统 Python，也不会重新下载模型。'
          : '图文检索、图片重排和内容处理共用。源码模式从启动后端的 Python 环境加载依赖。'
      "
      class="runtime-card"
    >
      <template v-if="state?.supported" #actions
        ><span class="runtime-state" :class="{ ready: state.check.ready }">{{
          label
        }}</span></template
      >
      <div v-if="state?.supported" class="runtime-actions">
        <a-select
          v-model:value="variant"
          aria-label="运行环境设备"
          :disabled="busy || global.conf?.is_readonly"
        >
          <a-select-option value="cu128">NVIDIA GPU · CUDA 12.8</a-select-option>
          <a-select-option value="cpu">CPU</a-select-option>
        </a-select>
        <a-button
          :loading="pending"
          :disabled="busy || !state.installed || global.conf?.is_readonly"
          @click="run('check')"
          >检查环境</a-button
        >
        <a-button
          type="primary"
          :disabled="busy || global.conf?.is_readonly"
          @click="run('install')"
          >{{
            !state.installed
              ? '安装必要依赖'
              : state.update_available
                ? '更新运行环境'
                : '修复／重新安装'
          }}</a-button
        >
      </div>
      <p v-if="state && !state.supported">
        源码模式使用启动后端的 Python 环境。PyTorch 与其他 AI 依赖由该环境管理，变更后请重启后端。
      </p>
      <p v-if="state?.supported && variant === 'cu128' && !state.installed">
        首次 GPU 安装需要数 GB 空间。
      </p>
      <a-progress
        v-if="state?.supported && state.job.running"
        :percent="state.job.progress"
        :show-info="false"
        aria-label="运行环境安装阶段进度"
      />
      <p v-if="state?.supported && state.job.stage" role="status">{{ state.job.stage }}</p>
      <p v-if="state?.supported && state.check.device">当前推理设备：{{ state.check.device }}</p>
      <a-alert
        v-if="error || state?.job.error"
        type="error"
        :message="error || state?.job.error"
        show-icon
      />
      <details v-if="state?.supported">
        <summary>运行环境详情</summary>
        <p class="runtime-path">{{ state.path }}</p>
        <p>兼容版本：{{ state.recipe }}</p>
        <dl>
          <template v-for="(version, name) in state.check.versions" :key="name"
            ><dt>{{ name }}</dt>
            <dd>{{ version }}</dd></template
          >
        </dl>
      </details>
    </SettingsGroup>
  </div>
</template>

<style scoped>
.runtime-container {
  scroll-margin-top: 16px;
}
.runtime-card :deep(.settings-group-body) {
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
.runtime-actions :deep(.ant-select) {
  flex: 1;
  min-width: 180px;
}
p,
summary {
  font-size: 12px;
  color: var(--zp-secondary);
  margin: 10px 0;
  line-height: 1.7;
}
.runtime-path {
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
}
dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 16px;
  font-size: 12px;
}
dd {
  margin: 0;
}
@container (max-width: 650px) {
  .runtime-card :deep(.settings-group-body) {
    padding: 16px;
  }
}
</style>
