<script setup lang="ts">
import { useApplicationStore } from '@/features/application/public'
import { ref } from 'vue'
import {
  browseShortcuts,
  imageStudioShortcuts,
  aiImageEditorShortcuts
} from '@/shared/lib/shortcut'
import BrowseSettings from './BrowseSettings.vue'
import TagConfiguration from './TagConfiguration.vue'
import GeneralSettings from './GeneralSettings.vue'
import AIIntegrationSettings from './AIIntegrationSettings.vue'
import RuntimeSettings from './RuntimeSettings.vue'
import SyncSettings from './SyncSettings.vue'

const globalStore = useApplicationStore()
const category = ref('general')
const categories = [
  { key: 'general', label: '通用' },
  { key: 'browse', label: '浏览与预览' },
  { key: 'tags', label: '标签配置' },
  { key: 'runtime', label: '运行环境' },
  { key: 'ai', label: 'AI 接入' },
  { key: 'shortcuts', label: '快捷键' },
  { key: 'sync', label: '同步设置' }
]
</script>
<template>
  <div class="panel">
    <a-alert
      :message="$t('readonlyModeSettingPageDesc')"
      v-if="globalStore.conf?.is_readonly"
      type="warning"
    />
    <div class="settings-navigation" aria-label="设置分类">
      <button
        v-for="item in categories"
        :key="item.key"
        :class="{ active: category === item.key }"
        :aria-pressed="category === item.key"
        @click="category = item.key"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="settings-pages">
      <BrowseSettings v-show="category === 'browse'" />
      <TagConfiguration v-if="category === 'tags'" />
      <RuntimeSettings v-show="category === 'runtime'" :active="category === 'runtime'" />
      <AIIntegrationSettings
        v-show="category === 'ai'"
        :active="category === 'ai'"
        @open-runtime="category = 'runtime'"
      />
      <SyncSettings v-if="category === 'sync'" />
      <GeneralSettings v-show="category === 'general'" />
      <section v-if="category === 'shortcuts'" class="settings-section shortcut-settings">
        <h2>快捷键</h2>
        <div class="shortcut-table">
          <div class="shortcut-row shortcut-heading">
            <span>操作</span><span>按键</span><span>生效位置</span>
          </div>
          <h3 class="shortcut-group">媒体列表和预览</h3>
          <div v-for="item in browseShortcuts" :key="item.keys" class="shortcut-row fixed-shortcut">
            <span>{{ item.action }}</span>
            <div>
              <kbd>{{ item.keys }}</kbd
              ><small class="fixed-label">固定</small>
            </div>
            <span class="shortcut-scope">{{ item.scope }}</span>
          </div>
          <h3 class="shortcut-group">工作台·图片制作</h3>
          <div
            v-for="item in imageStudioShortcuts"
            :key="item.keys"
            class="shortcut-row fixed-shortcut"
          >
            <span>{{ item.action }}</span>
            <div>
              <kbd>{{ item.keys }}</kbd
              ><small class="fixed-label">固定</small>
            </div>
            <span class="shortcut-scope">{{ item.scope }}</span>
          </div>
          <h3 class="shortcut-group">AI 创作·图片编辑</h3>
          <div
            v-for="item in aiImageEditorShortcuts"
            :key="`${item.keys}-${item.scope}`"
            class="shortcut-row fixed-shortcut"
          >
            <span>{{ item.action }}</span>
            <div>
              <kbd>{{ item.keys }}</kbd
              ><small class="fixed-label">固定</small>
            </div>
            <span class="shortcut-scope">{{ item.scope }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
<style lang="scss" scoped>
.panel {
  padding: 24px 32px;
  background: var(--zp-secondary-background);
  overflow: auto;
  height: 100%;
}
.settings-navigation {
  display: flex;
  gap: 22px;
  width: 100%;
  max-width: 1100px;
  min-width: 0;
  box-sizing: border-box;
  overflow-x: auto;
  scrollbar-width: none;
  margin: 0 0 18px;
  padding: 0 2px;
  border-bottom: 1px solid var(--ui-border);
  button {
    flex: none;
    padding: 10px 2px 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--zp-secondary);
    font: inherit;
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
    &:hover {
      color: var(--ui-text);
    }
    &.active {
      color: var(--primary-color);
      border-bottom-color: var(--primary-color);
      font-weight: 650;
    }
    &:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: -3px;
    }
  }
}
.settings-section {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 24px;
  margin-bottom: 16px;
  border: 1px solid var(--zp-border);
  border-radius: 8px;
  background: var(--zp-primary-background);
}
@media (max-width: 760px) {
  .panel {
    padding: 16px;
  }
  .settings-section {
    padding: 16px;
  }
}

h2 {
  margin: 24px 0 20px;
  font-size: 17px;
  font-weight: 600;
  &:first-child {
    margin-top: 0;
  }
}

.panel {
  container-type: inline-size;
  min-width: 0;
}
@container (max-width: 650px) {
  .settings-navigation {
    gap: 4px;
  }
  .settings-navigation button {
    padding: 8px 12px;
  }
}
.shortcut-table {
  display: flex;
  flex-direction: column;
}
.shortcut-group {
  margin: 18px 0 4px;
  padding: 11px 12px;
  border-radius: 7px;
  background: var(--zp-secondary-background);
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 650;
}
.shortcut-row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(200px, 1.3fr) minmax(130px, 1fr);
  gap: 16px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--zp-border);
  font-size: 12px;
}
.shortcut-heading {
  color: var(--zp-secondary);
  font-weight: 600;
}
.shortcut-row kbd {
  display: inline-block;
  padding: 4px 7px;
  border: 1px solid var(--zp-border);
  border-radius: 5px;
  background: var(--zp-secondary-background);
  font:
    11px/1.5 ui-monospace,
    monospace;
  white-space: pre-wrap;
}
.fixed-label {
  margin-left: 8px;
  font-size: 10px;
  color: var(--zp-secondary);
}
.shortcut-scope {
  color: var(--zp-secondary);
  font-size: 11px;
}
@media (max-width: 850px) {
  .shortcut-row {
    grid-template-columns: 1fr 1.3fr;
    gap: 8px;
  }
  .shortcut-row > .shortcut-scope {
    grid-column: 1/-1;
  }
  .shortcut-heading > span:last-child {
    display: none;
  }
}
.panel {
  background: transparent;
}
.settings-navigation::-webkit-scrollbar {
  display: none;
}
.settings-section {
  max-width: 1100px;
  border-radius: var(--ui-radius-lg);
  box-shadow: 0 3px 14px #213b5908;
  animation: settings-enter var(--ui-motion) var(--ui-ease);
}
.settings-section h2 {
  font-size: 17px;
  letter-spacing: -0.02em;
}
@keyframes settings-enter {
  from {
    opacity: 0.72;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
