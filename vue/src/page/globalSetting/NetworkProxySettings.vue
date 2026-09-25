<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { checkNetworkProxy, getNetworkProxySettings, saveNetworkProxySettings, type NetworkProxyCheck, type NetworkProxySettings } from '@/api/networkProxy'
import { useGlobalStore } from '@/store/useGlobalStore'

const global = useGlobalStore()
const draft = ref<NetworkProxySettings>({enabled: false, url: ''})
const saved = ref<NetworkProxySettings>()
const loading = ref(true)
const saving = ref(false)
const checking = ref(false)
const error = ref('')
const result = ref<NetworkProxyCheck>()
const dirty = computed(() => !!saved.value && (draft.value.enabled !== saved.value.enabled || draft.value.url.trim() !== saved.value.url))

onMounted(async () => {
  try {
    const settings = await getNetworkProxySettings()
    saved.value = settings
    draft.value = {...settings}
  } catch (cause: any) {
    error.value = cause?.response?.data?.detail || cause?.message || '读取代理配置失败'
  } finally { loading.value = false }
})

async function save() {
  if (saving.value || global.conf?.is_readonly) return
  saving.value = true
  error.value = ''
  result.value = undefined
  try {
    const settings = await saveNetworkProxySettings({enabled: draft.value.enabled, url: draft.value.url.trim()})
    saved.value = settings
    draft.value = {...settings}
  } catch (cause: any) {
    error.value = cause?.response?.data?.detail || cause?.message || '保存代理配置失败'
  } finally { saving.value = false }
}

async function check() {
  if (checking.value || dirty.value || !saved.value?.enabled) return
  checking.value = true
  error.value = ''
  try { result.value = await checkNetworkProxy() }
  catch (cause: any) { error.value = cause?.response?.data?.detail || cause?.message || '验证代理失败' }
  finally { checking.value = false }
}
</script>

<template>
  <div class="proxy-settings">
    <div class="proxy-toggle">
      <a-switch v-model:checked="draft.enabled" aria-label="启用自定义代理" :disabled="loading || saving || !!global.conf?.is_readonly" @change="result = undefined" />
      <span>{{ draft.enabled ? '使用自定义代理' : '直连' }}</span>
    </div>
    <div v-if="draft.enabled" class="proxy-url-row">
      <a-input v-model:value="draft.url" aria-label="代理地址" :disabled="loading || saving || !!global.conf?.is_readonly" placeholder="http://127.0.0.1:7890" autocomplete="off" @press-enter.prevent="save" />
    </div>
    <p class="proxy-help">用于 Comfy Router / Cloud 请求和 Qwen3-VL 模型下载。</p>
    <div class="proxy-actions">
      <a-button type="primary" size="small" :loading="saving" :disabled="loading || !dirty || !!global.conf?.is_readonly" @click="save">保存代理设置</a-button>
      <a-button size="small" :loading="checking" :disabled="loading || dirty || !saved?.enabled" @click="check">测试 Comfy 连接</a-button>
      <span v-if="!loading" class="proxy-state" :class="{unsaved: dirty}" role="status">{{ dirty ? '有未保存的更改' : '已保存' }}</span>
    </div>
    <p v-if="result" class="proxy-result" :class="{failed: !result.ready}" role="status">{{ result.detail }}</p>
    <a-alert v-if="error" type="error" :message="error" show-icon />
  </div>
</template>

<style scoped>
.proxy-settings{min-width:0}.proxy-toggle,.proxy-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.proxy-toggle{font-size:13px}.proxy-url-row{margin-top:12px;max-width:520px}.proxy-help{margin:10px 0 12px;color:var(--zp-secondary);font-size:12px;line-height:1.7}.proxy-state,.proxy-result{font-size:12px;color:var(--zp-secondary)}.proxy-state.unsaved,.proxy-result.failed{color:var(--ui-danger,#cf3d3d)}.proxy-result{margin:10px 0 0}
</style>
