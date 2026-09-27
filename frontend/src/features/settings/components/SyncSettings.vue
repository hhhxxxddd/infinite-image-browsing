<script setup lang="ts">
import { getErrorMessage } from '@/shared/lib/errorMessage'

import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { open } from '@tauri-apps/plugin-dialog'
import { chooseLocalDirectory } from '@/features/media-library/public'
import { getSyncSettings, saveSyncSettings } from '@/features/settings/api/storage'
import { updateImageData } from '@/features/media-library/public'
import { useApplicationStore } from '@/features/application/public'
import { globalEvents } from '@/features/application/public'
import { isTauri } from '@/shared/lib/env'
import SettingsGroup from './SettingsGroup.vue'
import SettingsRow from './SettingsRow.vue'
import './settingsControls.css'

const global = useApplicationStore()
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
  } catch {
    error.value = '读取同步设置失败，请重试'
  } finally {
    loading.value = false
  }
})

async function chooseFolder() {
  if (choosing.value) return
  choosing.value = true
  try {
    const result = isTauri
      ? await open({ directory: true, defaultPath: directory.value || undefined })
      : await chooseLocalDirectory()
    if (typeof result === 'string') directory.value = result
  } catch {
    message.error('无法打开文件夹选择器，请手动输入路径')
  } finally {
    choosing.value = false
  }
}

async function save() {
  if (saving.value || global.conf?.is_readonly) return
  saving.value = true
  error.value = ''
  try {
    const settings = await saveSyncSettings({
      enabled: enabled.value,
      directory: directory.value.trim()
    })
    enabled.value = settings.enabled
    directory.value = settings.directory
    globalEvents.emit('updateGlobalSetting')
    message.success(settings.enabled ? '同步设置已保存，开始扫描目录' : '已关闭按需文件保护')
    if (settings.enabled) {
      try {
        await updateImageData()
        globalEvents.emit('searchIndexExpired')
        message.success('OneDrive 目录扫描完成')
      } catch {
        message.warning('目录已添加，但扫描未完成；可在媒体库重试')
      }
    }
  } catch (cause) {
    error.value = getErrorMessage(cause, '保存失败，请检查目录是否存在')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="settings-stack">
    <SettingsGroup
      title="OneDrive 本地目录"
      help="文件传输由本机 OneDrive 完成，无需在万象馆登录账号。标签和应用数据库仍保存在本机。"
    >
      <SettingsRow
        label="按需文件保护"
        help="开启后，扫描仅在线文件时不读取内容，打开文件前会提示下载大小。关闭后按普通本地目录扫描，不会移除目录或更改 OneDrive 同步状态。"
        compact
      >
        <a-switch
          v-model:checked="enabled"
          :disabled="loading || saving || global.conf?.is_readonly"
          aria-label="按需文件保护"
        />
      </SettingsRow>
      <SettingsRow label="媒体文件夹">
        <div class="settings-control">
          <div class="settings-input-row">
            <a-input
              id="sync-directory"
              v-model:value="directory"
              aria-label="OneDrive 媒体文件夹"
              :disabled="loading || saving || global.conf?.is_readonly"
              placeholder="选择 OneDrive 管理的本地文件夹"
              @press-enter.prevent="save"
            />
            <a-button
              :loading="choosing"
              :disabled="loading || saving || global.conf?.is_readonly"
              @click="chooseFolder"
              >浏览…</a-button
            >
          </div>
          <p class="settings-note">保存并开启后，目录会加入媒体库；关闭保护后按普通目录扫描。</p>
          <div class="settings-actions">
            <a-button
              type="primary"
              :loading="saving"
              :disabled="loading || global.conf?.is_readonly"
              @click="save"
              >保存设置</a-button
            >
            <span v-if="saving && enabled" class="settings-state" role="status"
              >正在扫描；仅在线文件不会下载</span
            >
          </div>
          <a-alert v-if="error" type="error" :message="error" show-icon />
        </div>
      </SettingsRow>
    </SettingsGroup>
  </div>
</template>
