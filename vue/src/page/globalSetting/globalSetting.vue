<script setup lang="ts">
import { t } from '@/i18n'
import { useGlobalStore, type Shortcut, type DefaultInitinalPage } from '@/store/useGlobalStore'
import { useWorkspeaceSnapshot } from '@/store/useWorkspeaceSnapshot'
import { computed, ref } from 'vue'
import { SearchSelect} from 'vue3-ts-util'
import { sortMethodConv, sortMethods } from '@/page/fileTransfer/fileSort'
import { getShortcutStrFromEvent } from '@/util/shortcut'
import ImageSetting from './ImageSetting.vue'
import AutoTagSettings from './AutoTagSettings.vue'
import { openRebuildImageIndexModal } from '@/components/functionalCallableComp'
import { Dict } from '@/util'
import { message } from 'ant-design-vue'
import { throttle, debounce } from 'lodash-es'
import { useLocalStorage } from '@vueuse/core'
import { prefix } from '@/util/const'

const globalStore = useGlobalStore()
const wsStore = useWorkspeaceSnapshot()
const category = ref('browse')
const categories = [
  { key: 'browse', label: '浏览与预览' },
  { key: 'index', label: '扫描与刷新' },
  { key: 'tags', label: '自动标签' },
  { key: 'general', label: '通用' },
  { key: 'shortcuts', label: '快捷键' }
]

const langChanged = ref(false)
const reload = async () => {
  window.location.reload()
}
const langs: { text: string, value: string }[] = [
  { value: 'en', text: 'English' },
  { value: 'zhHans', text: '简体中文' },
  { value: 'zhHant', text: '繁體中文' },
  { value: 'de', text: 'Deutsch' }
]
const doubleCheck = debounce((key: keyof Shortcut) => {
  
  const keysStr = globalStore.shortcut[key] as string
  if (['ctrl', 'shift'].includes(keysStr.toLowerCase())) {
    globalStore.shortcut[key] = ''
  }
}, 700)
const simpleKeyWarn = throttle(() => {
  message.warn(t('notAllowSingleCtrlOrShiftAsShortcut'))
}, 3000)
const onShortcutKeyDown = (e: KeyboardEvent, key: keyof Shortcut) => {
  const keysStr = getShortcutStrFromEvent(e)
  if (['ctrl', 'shift'].includes(keysStr.toLowerCase())) {
    simpleKeyWarn()
    doubleCheck(key)
  }
  if (keysStr) {
    globalStore.shortcut[key] = keysStr
  }
}

const defaultInitinalPageOptions = computed(() => {
  const r: { text: string, value: DefaultInitinalPage }[] = [
    { value: 'empty', text: t('emptyStartPage') },
    { value: 'last-workspace-state', text: t('restoreLastWorkspaceState') },
    ...wsStore.snapshots.map(item => ({ value: `workspace_snapshot_${item.id}` as `workspace_snapshot_${string}`, text: t('restoreWorkspaceSnapshot', [item.name]) }))
  ]
  return r
})
const shortCutsCountRec = computed(() => {
  const rec = globalStore.shortcut
  const res = {} as Dict<number>
  Object.values(rec).forEach((v) => {
    res[v + ''] ??= 0
    res[v + '']++
  })
  return res
})

const shortcutsList = computed(() => {
  const res = [{ key: 'download', label: t('download') }, { key: 'delete', label: t('deleteSelected') }] as { key: keyof Shortcut, label: string }[]
  globalStore.conf?.all_custom_tags.forEach(tag => {
    res.push({ key: `toggle_tag_${tag.name}`, label: t('toggleTagSelection', { tag: tag.name }) })
  })
  globalStore.quickMovePaths.forEach(item => {
    res.push({ key: `copy_to_${item.dir}`, label: t('copyTo') + ' ' + item.zh })
  })
  globalStore.quickMovePaths.forEach(item => {
    res.push({ key: `move_to_${item.dir}`, label: t('moveTo') + ' ' + item.zh })
  })
  return res
})

const isShortcutConflict = (keyStr: string) => {
  return keyStr && keyStr in shortCutsCountRec.value && shortCutsCountRec.value[keyStr] > 1
}
const disableMaximize = useLocalStorage(prefix+'disable_maximize', false)
const showPresetShortcutModal = ref(false)
const presetShortcutGroups = computed(() => ([
  {
    title: t('shortcutPresetSectionBrowse'),
    items: [
      {
        keys: 'PageUp / PageDown',
        location: t('shortcutPresetLocationFileList'),
        action: t('shortcutPresetActionPageJump')
      },
      {
        keys: 'Home / End',
        location: t('shortcutPresetLocationFileList'),
        action: t('shortcutPresetActionHomeEnd')
      },
      {
        keys: 'Backspace',
        location: t('shortcutPresetLocationFileList'),
        action: t('shortcutPresetActionBackspaceUp')
      },
      {
        keys: 'Ctrl + A / Cmd + A',
        location: t('shortcutPresetLocationFileList'),
        action: t('shortcutPresetActionSelectAll')
      }
    ]
  },
  {
    title: t('shortcutPresetSectionFullscreen'),
    items: [
      {
        keys: 'ArrowLeft / ArrowRight / ArrowUp / ArrowDown',
        location: t('shortcutPresetLocationFullscreen'),
        action: t('shortcutPresetActionFullscreenNavigate')
      },
      {
        keys: 'Esc',
        location: t('shortcutPresetLocationFullscreen'),
        action: t('shortcutPresetActionFullscreenExit')
      }
    ]
  },
  {
    title: t('shortcutPresetSectionTiktok'),
    items: [
      {
        keys: 'ArrowUp / ArrowDown',
        location: t('shortcutPresetLocationTiktok'),
        action: t('shortcutPresetActionTiktokNavigate')
      },
      {
        keys: 'Esc',
        location: t('shortcutPresetLocationTiktok'),
        action: t('shortcutPresetActionTiktokExit')
      }
    ]
  }
]))

// 自然语言分类&搜索 已提升到首页启动入口（TopicSearch），全局设置不再保留旧入口
</script>
<template>
  <div class="panel">
    <a-alert :message="$t('readonlyModeSettingPageDesc')" v-if="globalStore.conf?.is_readonly" type="warning" />
    <div class="settings-navigation" aria-label="设置分类">
      <button v-for="item in categories" :key="item.key" :class="{ active: category === item.key }" :aria-pressed="category === item.key" @click="category = item.key">{{ item.label }}</button>
    </div>
    <p class="settings-note">设置会自动保存到本机。</p>
    <a-form :colon="false">
      <section v-show="category === 'general'" class="settings-section">
      <h2>语言与启动</h2>
      <a-form-item :label="$t('lang')">
        <div class="lang-select-wrap">
          <SearchSelect :options="langs" v-model:value="globalStore.lang" @change="langChanged = true" />
        </div>
        <a-button type="primary" @click="reload" v-if="langChanged" ghost>{{
          t('langChangeReload')
          }}</a-button>
      </a-form-item>
      </section>
      <section v-show="category === 'browse'" class="settings-section">
      <h2>缩略图与预览</h2>
      <ImageSetting />
      </section>
      <section v-show="category === 'tags'" class="settings-section">
      <h2>{{ t('autoTag.name') }}</h2>
      <AutoTagSettings />
      </section>
      <section v-show="category === 'browse'" class="settings-section">
      <h2>逐张查看</h2>
      <a-form-item :label="$t('showTiktokNavigator')">
        <a-switch v-model:checked="globalStore.showTiktokNavigator" />
        <span style="margin-left: 8px;color: #666;">{{ t('showTiktokNavigatorDesc') }}</span>
      </a-form-item>

      </section>
      <section v-show="category === 'index'" class="settings-section">
      <h2>媒体索引</h2>
      <a-form-item :label="$t('rebuildImageIndex')">
        <AButton @click="openRebuildImageIndexModal">重建媒体索引</AButton>
      </a-form-item>
      <a-form-item :label="$t('autoUpdateIndex')">
        <a-switch v-model:checked="globalStore.autoUpdateIndex" />
        <span style="margin-left: 8px;color: #666;">{{ t('autoUpdateIndexDesc') }}</span>
      </a-form-item>

      <h2>{{ t('autoRefresh') }}</h2>
      <a-form-item label="包含子文件夹时自动刷新">
        <a-switch v-model:checked="globalStore.autoRefreshWalkMode" />
      </a-form-item>
      <a-form-item label="逐层浏览或直接打开时自动刷新">
        <a-switch v-model:checked="globalStore.autoRefreshNormalFixedMode" />
      </a-form-item>
      <a-form-item label="自动刷新触发位置（项）">
        <NumInput :min="0" :max="1024" :step="16" v-model="globalStore.autoRefreshWalkModePosLimit" />
      </a-form-item>

      </section>
      <section v-show="category === 'general'" class="settings-section">
      <h2>文件与操作</h2>
      <a-form-item :label="$t('fileTypeFilter')">
        <a-checkbox-group v-model:value="globalStore.fileTypeFilter">
          <a-checkbox value="all">{{ $t('allFiles') }}</a-checkbox>
          <a-checkbox value="image">{{ $t('image') }}</a-checkbox>
          <a-checkbox value="video">{{ $t('video') }}</a-checkbox>
          <a-checkbox value="audio">{{ $t('audio') }}</a-checkbox>
        </a-checkbox-group>
      </a-form-item>
      <!--在生成信息面板显示逗号-->
      <a-form-item :label="$t('showCommaInGenInfoPanel')">
        <a-switch v-model:checked="globalStore.showCommaInInfoPanel" />
      </a-form-item>
      <a-form-item :label="$t('defaultSortingMethod')">
        <search-select v-model:value="globalStore.defaultSortingMethod" :conv="sortMethodConv" :options="sortMethods" />
      </a-form-item>

      <a-form-item :label="$t('longPressOpenContextMenu')">
        <a-switch v-model:checked="globalStore.longPressOpenContextMenu" />
      </a-form-item>
      <a-form-item :label="$t('openOnAppStart')">
        <search-select v-model:value="globalStore.defaultInitinalPage" :options="defaultInitinalPageOptions" />
      </a-form-item>
      <a-form-item :label="$t(key + 'SkipConfirm')" v-for="_, key in globalStore.ignoredConfirmActions" :key="key">
        <ACheckbox v-model:checked="globalStore.ignoredConfirmActions[key]"></ACheckbox>
      </a-form-item>
      <a-form-item :label="$t('disableMaximize')">
        <a-switch v-model:checked="disableMaximize" />
        <sub style="padding-left: 8px;color: #666;">{{ $t('takeEffectAfterReloadPage') }}</sub>
      </a-form-item>

      

      </section>
      <a-modal v-model:open="showPresetShortcutModal" :title="t('shortcutPresetTitle')" width="800px" :footer="null">
        <div class="shortcut-preset-desc">{{ t('shortcutPresetDesc') }}</div>
        <div class="shortcut-preset-section" v-for="group in presetShortcutGroups" :key="group.title">
          <div class="shortcut-preset-section-title">{{ group.title }}</div>
          <div class="shortcut-preset-grid shortcut-preset-grid-header">
            <div>{{ t('shortcutPresetHeaderKey') }}</div>
            <div>{{ t('shortcutPresetHeaderWhere') }}</div>
            <div>{{ t('shortcutPresetHeaderAction') }}</div>
          </div>
          <div class="shortcut-preset-grid" v-for="item in group.items" :key="item.keys + item.action">
            <div class="mono">{{ item.keys }}</div>
            <div>{{ item.location }}</div>
            <div>{{ item.action }}</div>
          </div>
        </div>
      </a-modal>      
      <section v-show="category === 'shortcuts'" class="settings-section">
      <div class="shortcut-title-row">
        <h2>{{ t('shortcutKey') }}</h2>
      </div>
        <a-button type="link" @click="showPresetShortcutModal = true">
          {{ t('shortcutPresetButton') }}
        </a-button>
      <a-form-item :label="item.label" v-for="item in shortcutsList" :key="item.key">
        <div class="col" :class="{ conflict: isShortcutConflict(globalStore.shortcut[item.key] + '') }"

          @keydown.stop.prevent>
          <a-input :value="globalStore.shortcut[item.key]" @keydown.stop.prevent="onShortcutKeyDown($event, item.key)"
            placeholder="点击后按下快捷键" :title="$t('shortcutKeyDescription')" />
          <a-button @click="globalStore.shortcut[item.key] = ''" class="clear-btn">
            {{ $t('clear') }}
          </a-button>
        </div>
      </a-form-item>
      </section>
    </a-form>
  </div>
</template>
<style lang="scss" scoped>
.panel {
  padding: 24px 32px;
  background: var(--zp-secondary-background);
  overflow: auto;
  height: 100%;
}
.settings-navigation { display:flex; gap:6px; flex-wrap:wrap; button { padding:9px 18px; border:1px solid transparent; border-radius:6px; background:transparent; color:var(--zp-secondary); font:inherit; cursor:pointer; &.active { background:var(--zp-primary-background); color:var(--primary-color); border-color:var(--zp-border); font-weight:600; } } }
.settings-note { margin:18px 0; font-size:12px; color:var(--zp-secondary); }
.settings-section { max-width:1080px; padding:24px; margin-bottom:16px; border:1px solid var(--zp-border); border-radius:8px; background:var(--zp-primary-background); }
@media(max-width:760px) { .panel {padding:16px;} .settings-section {padding:16px;} }

.lang-select-wrap {
  width: 128px;
  display: inline-block;
  padding-right: 16px;
}

h2 {
  margin: 24px 0 20px;
  font-size:17px;
  font-weight:600;
  &:first-child {margin-top:0;}
}

.shortcut-title-row {
  display: flex;
  align-items: center;
  gap: 12px;

  h2 {
    margin: 0 0 16px;
  }
}

.shortcut-preset-desc {
  color: #666;
  margin-bottom: 12px;
}

.shortcut-preset-section {
  margin-top: 16px;
}

.shortcut-preset-section-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.shortcut-preset-grid {
  display: grid;
  grid-template-columns: 220px 240px 1fr;
  gap: 8px 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--zp-secondary-background);
}

.shortcut-preset-grid-header {
  font-weight: 600;
  color: #666;
  border-bottom: 1px solid var(--zp-secondary-background);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.row {
  margin-top: 16px;
  padding: 0 16px;
}

.col {
  display: flex;

  &.conflict {
    border-bottom: 1px solid red;
    position: relative;

    &::after {
      position: absolute;
      top: -16px;
      left: 0;
      background: white;
      color: red;
      content: 'conflict';
    }
  }
}

.clear-btn {
  margin-left: 16px;
}


.panel{container-type:inline-size;min-width:0;}
.settings-section :deep(.ant-form-item-row){display:grid;grid-template-columns:minmax(160px,220px) minmax(0,1fr);gap:16px;align-items:start;}
.settings-section :deep(.ant-form-item-label){text-align:left;white-space:normal;overflow:visible;padding:4px 0;}
.settings-section :deep(.ant-form-item-label > label){height:auto;line-height:1.6;white-space:normal;overflow-wrap:anywhere;}
.settings-section :deep(.ant-form-item-control-input-content){min-width:0;}
.settings-section :deep(.ant-switch){flex-shrink:0;vertical-align:middle;}
.settings-section :deep(.ant-checkbox-group){display:flex;flex-wrap:wrap;gap:8px 16px;}
.settings-section :deep(.ant-checkbox-wrapper){margin:0;}
.settings-section :deep(.ant-form-item:last-child){margin-bottom:0;}
.settings-section :deep(.ant-form-item-control-input-content > span:not(.ant-input-affix-wrapper)){line-height:1.7;}
.lang-select-wrap{width:100%;max-width:260px;padding:0;}
.col{gap:8px;min-width:0;}.col .ant-input{min-width:0;}.clear-btn{margin-left:0;flex-shrink:0;}
.shortcut-preset-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr);overflow-wrap:anywhere;line-height:1.6;}
@container(max-width:650px){.settings-section :deep(.ant-form-item-row){grid-template-columns:minmax(0,1fr);gap:6px;}.settings-section :deep(.ant-form-item-label){padding:0;}.settings-navigation{gap:4px;}.settings-navigation button{padding:8px 12px;}}
@media(max-width:500px){.shortcut-preset-grid{grid-template-columns:minmax(0,1fr);gap:4px;}.shortcut-preset-grid-header{display:none;}}

</style>
