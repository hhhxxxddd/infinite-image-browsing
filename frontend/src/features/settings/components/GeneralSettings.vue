<script setup lang="ts">
import { ref } from 'vue'
import { useApplicationStore } from '@/features/application/public'
import { imageExtensions, videoExtensions, audioExtensions } from '@/shared/lib/mediaFormats'
import ArchiveSettings from './ArchiveSettings.vue'
import ProjectStorageSettings from './ProjectStorageSettings.vue'
import NetworkProxySettings from './NetworkProxySettings.vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingsRow from './SettingsRow.vue'
import SettingsHelp from './SettingsHelp.vue'

const globalStore = useApplicationStore()
const langChanged = ref(false)
const reload = () => window.location.reload()
const languages = [
  { value: 'en', label: 'English' },
  { value: 'zhHans', label: '简体中文' },
  { value: 'zhHant', label: '繁體中文' },
  { value: 'de', label: 'Deutsch' }
]
const formats = [
  { label: '图片', extensions: imageExtensions },
  { label: '视频', extensions: videoExtensions },
  { label: '音频', extensions: audioExtensions }
]
</script>

<template>
  <div class="general-settings">
    <SettingsGroup title="基础与操作">
      <SettingsRow :label="$t('lang')" compact>
        <div class="language-control">
          <a-button v-if="langChanged" type="link" @click="reload">{{
            $t('langChangeReload')
          }}</a-button>
          <a-select
            v-model:value="globalStore.lang"
            :options="languages"
            :aria-label="$t('lang')"
            @change="langChanged = true"
          />
        </div>
      </SettingsRow>
      <SettingsRow
        label="长按打开菜单"
        help="适合触屏操作。长按文件卡片可打开菜单；使用鼠标时也可以右键打开。"
        compact
      >
        <a-switch
          v-model:checked="globalStore.longPressOpenContextMenu"
          aria-label="长按文件卡片打开菜单"
        />
      </SettingsRow>
      <SettingsRow
        label="删除单个文件前确认"
        help="适用于列表和预览中的单文件删除。批量删除、删除文件夹始终需要确认。"
        compact
      >
        <a-switch
          :checked="!globalStore.ignoredConfirmActions.deleteOneOnly"
          aria-label="删除单个文件前确认"
          @change="globalStore.ignoredConfirmActions.deleteOneOnly = !$event"
        />
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title="存储位置">
      <SettingsRow
        label="项目数据目录"
        help="存放工作区素材、媒体编辑数据与素材快照，不会扫描进媒体库。修改时会迁移已有数据，校验成功后才切换；目标目录已有项目数据时不会覆盖。"
      >
        <ProjectStorageSettings />
      </SettingsRow>
      <SettingsRow
        label="归档目录"
        help="归档操作的文件保存位置。请填写文件服务所在电脑上的绝对路径；目录不存在时会自动创建。"
      >
        <ArchiveSettings :show-label="false" />
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title="网络连接">
      <SettingsRow
        label="自定义代理"
        help="用于 Comfy Router / Cloud 请求、Qwen3-VL 模型下载和桌面 AI 运行环境安装。关闭后使用直连；更改后需要保存。"
      >
        <NetworkProxySettings />
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title="支持的文件格式">
      <template #extra>
        <SettingsHelp label="支持的文件格式">
          <p>这些扩展名可扫描进媒体库，并按图片、视频、音频分类显示。</p>
          <p>
            收录不代表一定能播放。播放器使用浏览器或桌面 WebView 的解码器，不会实时转码。优先推荐
            MP4（H.264 视频 + AAC 音频）。
          </p>
        </SettingsHelp>
      </template>
      <dl class="format-list">
        <div v-for="format in formats" :key="format.label" class="format-row">
          <dt>{{ format.label }}</dt>
          <dd>
            <span v-for="extension in format.extensions" :key="extension">{{ extension }}</span>
          </dd>
        </div>
      </dl>
    </SettingsGroup>
  </div>
</template>

<style scoped>
.general-settings {
  display: grid;
  gap: 16px;
  max-width: 1100px;
  min-width: 0;
  padding-bottom: 16px;
}
.language-control {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
.language-control :deep(.ant-select) {
  width: 180px;
}
.format-list {
  margin: 0;
  padding: 14px 0;
}
.format-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 6px 0;
  font-size: 12px;
}
.format-row dt {
  color: var(--zp-secondary);
  line-height: 26px;
}
.format-row dd {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}
.format-row dd span {
  padding: 3px 8px;
  border-radius: 5px;
  background: var(--ui-surface-soft);
  color: var(--zp-secondary);
  line-height: 20px;
}
</style>
