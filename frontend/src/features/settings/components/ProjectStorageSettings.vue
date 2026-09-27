<script setup lang="ts">
import { getErrorMessage } from '@/shared/lib/errorMessage'

import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { chooseLocalDirectory } from '@/features/media-library/public'
import {
  getProjectStorage,
  saveProjectStorage,
  type ProjectStorageSettings
} from '@/features/settings/api/storage'
import { useApplicationStore } from '@/features/application/public'
const global = useApplicationStore()
const settings = ref<ProjectStorageSettings>()
const directory = ref('')
const saving = ref(false)
const choosing = ref(false)
const error = ref('')
onMounted(async () => {
  try {
    settings.value = await getProjectStorage()
    directory.value = settings.value.directory
  } catch {
    error.value = '读取项目数据目录失败，请重新打开设置。'
  }
})
async function browse() {
  choosing.value = true
  try {
    const path = await chooseLocalDirectory()
    if (path) directory.value = path
  } catch {
    error.value = '无法打开目录选择器，请填写文件服务所在电脑的绝对路径。'
  } finally {
    choosing.value = false
  }
}
async function save(reset = false) {
  saving.value = true
  error.value = ''
  try {
    settings.value = await saveProjectStorage(reset ? '' : directory.value.trim())
    directory.value = settings.value.directory
    message.success(settings.value.migrated ? '数据已校验并迁移，正在使用新目录' : '已在使用此目录')
  } catch (cause) {
    error.value = getErrorMessage(cause, '迁移失败，仍使用原目录。请检查磁盘空间和写入权限。')
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <div class="project-storage">
    <p>存放工作区素材、媒体编辑数据与素材快照，不会扫描进媒体库。</p>
    <div class="path-control">
      <a-input
        v-model:value="directory"
        aria-label="项目数据目录"
        :placeholder="settings?.default_directory || '填写绝对目录路径'"
        :disabled="saving || global.conf?.is_readonly"
        @press-enter.prevent="save()"
      />
      <a-button :loading="choosing" :disabled="saving || global.conf?.is_readonly" @click="browse"
        >浏览…</a-button
      >
    </div>
    <p class="path">当前目录：{{ settings?.directory || '读取中…' }}</p>
    <p class="path">默认目录：{{ settings?.default_directory || '读取中…' }}</p>
    <div class="actions">
      <a-button
        type="primary"
        :loading="saving"
        :disabled="!settings || !directory.trim() || global.conf?.is_readonly"
        @click="save()"
        >{{ saving ? '正在校验并迁移…' : '迁移并使用' }}</a-button
      >
      <a-button
        :disabled="
          saving ||
          !settings ||
          settings.directory === settings.default_directory ||
          global.conf?.is_readonly
        "
        @click="save(true)"
        >恢复默认目录</a-button
      >
    </div>
    <p>
      修改目录会迁移已有数据，校验成功后切换。原目录保留备份，可确认新目录正常后手动清理；目标目录中已有项目数据时不会覆盖。
    </p>
    <a-alert
      v-if="settings?.previous_directory"
      type="success"
      :message="`已切换。原数据备份保留在：${settings.previous_directory}`"
      show-icon
    />
    <a-alert v-if="error" type="error" :message="error" show-icon />
  </div>
</template>
<style scoped>
.project-storage {
  width: 100%;
  min-width: 0;
}
.project-storage p {
  color: var(--zp-secondary);
  font-size: 12px;
  line-height: 1.7;
  margin: 0 0 10px;
}
.path-control {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.path-control .ant-input {
  min-width: 0;
  flex: 1;
  width: 0;
}
.path-control .ant-btn {
  flex-shrink: 0;
  white-space: nowrap;
}
.path {
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.ant-alert {
  margin-top: 12px;
}
</style>
