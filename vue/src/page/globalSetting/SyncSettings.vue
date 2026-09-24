<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { open } from '@tauri-apps/plugin-dialog'
import { chooseLocalDirectory, getSyncSettings, saveSyncSettings } from '@/api'
import { updateImageData } from '@/api/db'
import { useGlobalStore } from '@/store/useGlobalStore'
import { globalEvents } from '@/util'
import { isTauri } from '@/util/env'

const global = useGlobalStore()
const enabled = ref(false)
const directory = ref('')
const loading = ref(true)
const choosing = ref(false)
const saving = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    const settings = await getSyncSettings()
    enabled.value = settings.enabled
    directory.value = settings.directory
  } catch { error.value = '读取同步设置失败，请重试' }
  finally { loading.value = false }
})

async function chooseFolder() {
  if (choosing.value) return
  choosing.value = true
  try {
    const result = isTauri
      ? await open({ directory: true, defaultPath: directory.value || undefined })
      : await chooseLocalDirectory()
    if (typeof result === 'string') directory.value = result
  } catch { message.error('无法打开文件夹选择器，请手动输入路径') }
  finally { choosing.value = false }
}

async function save() {
  if (saving.value || global.conf?.is_readonly) return
  saving.value = true
  error.value = ''
  try {
    const settings = await saveSyncSettings({ enabled: enabled.value, directory: directory.value.trim() })
    enabled.value = settings.enabled
    directory.value = settings.directory
    globalEvents.emit('updateGlobalSetting')
    message.success(settings.enabled ? '同步设置已保存，开始扫描目录' : '已关闭按需文件保护')
    if (settings.enabled) {
      try {
        await updateImageData()
        globalEvents.emit('searchIndexExpired')
        message.success('OneDrive 目录扫描完成')
      } catch { message.warning('目录已添加，但扫描未完成；可在媒体库重试') }
    }
  } catch (cause: any) {
    error.value = cause?.response?.data?.detail || '保存失败，请检查目录是否存在'
  } finally { saving.value = false }
}
</script>

<template>
  <div class="sync-settings">
    <div class="sync-intro"><strong>OneDrive 本地目录</strong><p>拾影读取这台电脑上由 OneDrive 管理的文件夹；文件传输由 OneDrive 完成，无需在拾影登录账号。</p></div>
    <div class="sync-row"><div><strong>按需文件保护</strong><p>开启后，仅在线文件会显示在媒体库中。后台扫描不读取内容；打开文件前会提示下载大小。</p></div><a-switch v-model:checked="enabled" :disabled="loading || saving || global.conf?.is_readonly" aria-label="按需文件保护" /></div>
    <label for="sync-directory">OneDrive 媒体文件夹</label>
    <div class="sync-directory"><a-input id="sync-directory" v-model:value="directory" :disabled="loading || saving || global.conf?.is_readonly" placeholder="选择 OneDrive 管理的本地文件夹" @press-enter.prevent="save" /><a-button :loading="choosing" :disabled="loading || saving || global.conf?.is_readonly" @click="chooseFolder">浏览文件夹…</a-button></div>
    <p class="sync-hint">保存并开启后，该目录会加入媒体库。关闭保护不会移除目录，也不会改变 OneDrive 的同步状态；之后的扫描会按普通本地目录读取文件。标签和应用数据库仍保存在本机。</p>
    <div class="sync-actions"><a-button type="primary" :loading="saving" :disabled="loading || global.conf?.is_readonly" @click="save">保存设置</a-button><span v-if="saving && enabled">正在扫描；仅在线文件不会下载</span></div>
    <a-alert v-if="error" type="error" :message="error" show-icon />
  </div>
</template>

<style scoped>
.sync-settings{width:100%;display:flex;flex-direction:column;gap:18px;color:var(--ui-text)}
.sync-intro strong{font-size:15px}.sync-intro p,.sync-row p,.sync-hint{margin:5px 0 0;color:var(--ui-muted);font-size:12px;line-height:1.7}
.sync-row{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:17px 18px;border:1px solid var(--ui-border);border-radius:var(--ui-radius);background:var(--ui-surface-soft)}
.sync-row strong{font-size:13px}.sync-row p{max-width:610px}.sync-row :deep(.ant-switch){flex:none}
.sync-settings>label{font-size:13px;font-weight:600;margin-bottom:-10px}.sync-directory{display:flex;gap:8px}.sync-directory :deep(.ant-input){min-width:0;flex:1}.sync-directory :deep(.ant-btn){flex:none}
.sync-hint{margin:-7px 0 0}.sync-actions{display:flex;align-items:center;gap:12px}.sync-actions span{color:var(--ui-muted);font-size:12px}
@media(max-width:580px){.sync-directory{flex-wrap:wrap}.sync-directory :deep(.ant-input){flex-basis:100%}}
</style>
