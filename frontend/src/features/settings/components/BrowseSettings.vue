<script setup lang="ts">
import { useApplicationStore } from '@/features/application/public'
import { openRebuildImageIndexModal } from '@/features/media-library/public'
import ImageSetting from './ImageSetting.vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingsRow from './SettingsRow.vue'
import './settingsControls.css'
const global = useApplicationStore()
</script>

<template>
  <div class="settings-stack">
    <SettingsGroup title="缩略图与预览"><ImageSetting /></SettingsGroup>
    <SettingsGroup title="媒体索引">
      <SettingsRow
        :label="$t('autoUpdateIndex')"
        help="页面打开时每分钟检查文件变化。增量扫描完成后，点击媒体库中的“刷新列表”查看新增内容。"
        compact
      >
        <a-switch v-model:checked="global.autoUpdateIndex" :aria-label="$t('autoUpdateIndex')" />
      </SettingsRow>
      <SettingsRow
        :label="$t('rebuildImageIndex')"
        help="索引异常或需要重新解析全部生成信息时使用。日常新增文件通过增量扫描更新。"
      >
        <a-button @click="openRebuildImageIndexModal">重建媒体索引</a-button>
      </SettingsRow>
    </SettingsGroup>
  </div>
</template>
