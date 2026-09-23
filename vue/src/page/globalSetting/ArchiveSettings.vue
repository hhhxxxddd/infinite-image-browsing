<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { getArchiveSettings, saveArchiveSettings } from '@/api'
import { useGlobalStore } from '@/store/useGlobalStore'
const global = useGlobalStore()
const directory = ref(global.conf?.archive?.custom_directory ?? '')
const saving = ref(false)
const error = ref('')
const emit = defineEmits<{ saved: [] }>()
onMounted(async () => {
  try {
    const settings = await getArchiveSettings()
    if (global.conf) global.conf.archive = settings
    directory.value = settings.custom_directory
  } catch { error.value = '读取归档目录失败，请重试' }
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
  } catch (e: any) {
    error.value = e.response?.data?.detail || '保存失败，请检查路径和目录权限'
  } finally { saving.value = false }
}
</script>
<template>
  <div class="archive-settings">
    <label>归档目录</label>
    <a-input v-model:value="directory" :disabled="saving || global.conf?.is_readonly" :placeholder="global.conf?.archive?.default_directory || '填写绝对目录路径'" aria-label="归档目录" @press-enter.prevent="save()" />
    <p v-if="global.conf?.is_win">例如 D:\图片归档，目录不存在时会自动创建。</p>
    <p v-else>填写运行媒体库的机器上的绝对目录路径。</p>
    <p class="current-directory">当前目录：{{ global.conf?.archive?.directory || '读取中…' }}</p>
    <div class="archive-actions"><a-button type="primary" size="small" :loading="saving" :disabled="global.conf?.is_readonly" @click="save()">保存目录</a-button><a-button size="small" :disabled="saving || global.conf?.is_readonly" @click="save(true)">恢复默认</a-button></div>
    <p>只影响之后的归档，已有文件不会移动。</p>
    <a-alert v-if="error" type="error" :message="error" show-icon />
  </div>
</template>
<style scoped>
.archive-settings{max-width:600px;}.archive-settings>label{display:block;margin-bottom:8px;font-size:13px;}.archive-settings p{color:var(--zp-secondary);font-size:12px;line-height:1.7;margin:8px 0;}.current-directory{overflow-wrap:anywhere;}.archive-actions{display:flex;gap:8px;margin:12px 0;}
</style>
