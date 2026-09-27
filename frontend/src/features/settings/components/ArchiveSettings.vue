<script setup lang="ts">
import { getErrorMessage } from '@/shared/lib/errorMessage'

import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { getArchiveSettings, saveArchiveSettings } from '@/features/settings/api/storage'
import { useApplicationStore } from '@/features/application/public'
import SettingsHelp from './SettingsHelp.vue'
import './settingsControls.css'

withDefaults(defineProps<{ showLabel?: boolean }>(), { showLabel: true })
const global = useApplicationStore()
const directory = ref(global.conf?.archive?.custom_directory ?? '')
const saving = ref(false)
const error = ref('')
const emit = defineEmits<{ saved: [] }>()
onMounted(async () => {
  try {
    const settings = await getArchiveSettings()
    if (global.conf) global.conf.archive = settings
    directory.value = settings.custom_directory
  } catch {
    error.value = '读取归档目录失败，请重试'
  }
})
async function save(reset = false) {
  saving.value = true
  error.value = ''
  try {
    const settings = await saveArchiveSettings(reset ? '' : directory.value.trim())
    if (global.conf) global.conf.archive = settings
    directory.value = settings.custom_directory
    message.success('归档目录已保存')
    emit('saved')
  } catch (e) {
    error.value = getErrorMessage(e, '保存失败，请检查路径和目录权限')
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <div class="settings-control">
    <div v-if="showLabel" class="settings-control-label">
      归档目录
      <SettingsHelp label="归档目录"
        >填写文件服务所在电脑上的绝对路径；目录不存在时会自动创建。</SettingsHelp
      >
    </div>
    <a-input
      v-model:value="directory"
      :disabled="saving || global.conf?.is_readonly"
      :placeholder="global.conf?.archive?.default_directory || '填写绝对目录路径'"
      aria-label="归档目录"
      @press-enter.prevent="save()"
    />
    <p class="settings-current-path">
      <span>当前使用</span><code>{{ global.conf?.archive?.directory || '读取中…' }}</code>
    </p>
    <div class="settings-actions">
      <a-button
        type="primary"
        :loading="saving"
        :disabled="global.conf?.is_readonly"
        @click="save()"
        >保存目录</a-button
      ><a-button :disabled="saving || global.conf?.is_readonly" @click="save(true)"
        >恢复默认</a-button
      >
    </div>
    <p class="settings-note">仅用于之后的归档，已有文件不会移动。</p>
    <a-alert v-if="error" type="error" :message="error" show-icon />
  </div>
</template>
