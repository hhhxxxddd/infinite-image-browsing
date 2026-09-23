<script setup lang="ts">
import { tagLabel } from '@/util/tagLabel'
import { t } from '@/i18n'
import { useGlobalStore, type Shortcut } from '@/store/useGlobalStore'
import { computed, ref } from 'vue'
import { SearchSelect } from 'vue3-ts-util'
import { getShortcutStrFromEvent, formatShortcut, shortcutRestriction, fixedShortcuts } from '@/util/shortcut'
import ImageSetting from './ImageSetting.vue'
import TagConfiguration from './TagConfiguration.vue'
import ArchiveSettings from './ArchiveSettings.vue'
import AIIntegrationSettings from './AIIntegrationSettings.vue'
import { openRebuildImageIndexModal } from '@/components/functionalCallableComp'
import { message } from 'ant-design-vue'
import { imageExtensions, videoExtensions, audioExtensions } from '@/util/mediaFormats'

const globalStore = useGlobalStore()
const category = ref('browse')
const categories = [
  { key: 'browse', label: '浏览与预览' },
  { key: 'index', label: '扫描与索引' },
  { key: 'ai', label: 'AI 接入' },
  { key: 'tags', label: '标签配置' },
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
const shortcutsList = computed(() => [
  {key:'download' as keyof Shortcut, label:'下载当前文件'},
  {key:'delete' as keyof Shortcut, label:'删除当前文件'},
  ...(globalStore.conf?.all_custom_tags ?? []).map(tag => ({key:`toggle_tag_${tag.name}` as keyof Shortcut,label:`切换“${tagLabel(tag)}”标签`}))
])
const shortcutError = ref('')
const shortcutProblem = (key: keyof Shortcut) => {
  const value = globalStore.shortcut[key]
  if (!value) return ''
  return shortcutRestriction(value) || (shortcutsList.value.some(item => item.key !== key && globalStore.shortcut[item.key] === value) ? '与其他操作重复，请重新设置' : '')
}
const onShortcutKeyDown = (event: KeyboardEvent, key: keyof Shortcut) => {
  if (event.key === 'Tab') return
  event.preventDefault()
  if (event.key === 'Escape') { (event.target as HTMLElement).blur(); return }
  const value = getShortcutStrFromEvent(event)
  if (!value) return
  const error = shortcutRestriction(value) || (shortcutsList.value.some(item => item.key !== key && globalStore.shortcut[item.key] === value) ? '此快捷键已被其他操作使用' : '')
  shortcutError.value = error
  if (error) { message.warning(error); return }
  globalStore.shortcut[key] = value
}

</script>
<template>
  <div class="panel">
    <a-alert :message="$t('readonlyModeSettingPageDesc')" v-if="globalStore.conf?.is_readonly" type="warning" />
    <div class="settings-navigation" aria-label="设置分类">
      <button v-for="item in categories" :key="item.key" :class="{ active: category === item.key }" :aria-pressed="category === item.key" @click="category = item.key">{{ item.label }}</button>
    </div>
    <a-form :colon="false">
      <section v-show="category === 'browse'" class="settings-section">
      <h2>缩略图与预览</h2>
      <ImageSetting />
      </section>
      <section v-show="category === 'tags'" class="settings-section">
      <h2>标签配置</h2>
      <TagConfiguration />
      </section>
      <section v-show="category === 'index'" class="settings-section">
      <h2>媒体索引</h2>
      <a-form-item :label="$t('rebuildImageIndex')">
        <AButton @click="openRebuildImageIndexModal">重建媒体索引</AButton><p class="index-help">仅在索引异常或需要重新解析全部生成信息时使用。日常新增图片会通过增量扫描更新。</p>
      </a-form-item>
      <a-form-item :label="$t('autoUpdateIndex')">
        <a-switch v-model:checked="globalStore.autoUpdateIndex" />
        <span style="margin-left: 8px;color: #666;">页面打开时每分钟检查一次变化，后台增量扫描；不自动重建、不强制刷新列表。</span>
      </a-form-item>

      <p class="setting-help">扫描完成后，媒体库会提示“刷新列表”。点击后显示新增内容，浏览时不会自动跳回顶部。</p>
      </section>
      <section v-show="category === 'ai'" class="settings-section">
      <h2>AI 接入</h2>
      <p class="setting-help">配置图文检索、图片重排和图片内容处理所用的模型，查看本地索引状态，并设置内容处理的提示词与服务来源。</p>
      <AIIntegrationSettings />
      </section>
      <section v-show="category === 'general'" class="settings-section general-settings">
        <h2>通用</h2>
        <div class="general-setting-row">
          <div class="general-setting-label">{{ $t('lang') }}</div>
          <div class="general-setting-content language-control">
            <div class="lang-select-wrap"><SearchSelect :options="langs" v-model:value="globalStore.lang" @change="langChanged = true" /></div>
            <a-button v-if="langChanged" type="primary" ghost @click="reload">{{ t('langChangeReload') }}</a-button>
          </div>
        </div>
        <div class="general-setting-row">
          <div class="general-setting-label">归档目录</div>
          <div class="general-setting-content"><ArchiveSettings /></div>
        </div>
        <div class="general-setting-row">
          <div class="general-setting-label">文件格式</div>
          <div class="general-setting-content">
            <p class="setting-help">以下扩展名可被扫描进媒体库。按类型浏览请使用左侧“图片”“视频”入口；音频包含在“全部媒体”中。</p>
            <dl class="format-list"><dt>图片</dt><dd>{{ imageExtensions.join(' · ') }}</dd><dt>视频</dt><dd>{{ videoExtensions.join(' · ') }}</dd><dt>音频</dt><dd>{{ audioExtensions.join(' · ') }}</dd></dl>
            <p class="setting-help">扩展名只决定能否收录，不保证能播放。内置播放器直接使用浏览器或桌面 WebView 的解码器，不会实时转码；兼容性优先推荐 MP4（H.264 视频 + AAC 音频）。</p>
          </div>
        </div>
        <div class="general-setting-row">
          <div class="general-setting-label">长按文件卡片打开菜单</div>
          <div class="general-setting-content">
            <a-switch v-model:checked="globalStore.longPressOpenContextMenu" aria-label="长按文件卡片打开菜单" />
            <p class="setting-help">适合触屏操作。鼠标右键和卡片上的“更多”按钮仍可直接打开菜单。</p>
          </div>
        </div>
        <div class="general-setting-row">
          <div class="general-setting-label">删除单个文件前确认</div>
          <div class="general-setting-content">
            <a-switch :checked="!globalStore.ignoredConfirmActions.deleteOneOnly" aria-label="删除单个文件前确认" @change="globalStore.ignoredConfirmActions.deleteOneOnly = !$event" />
            <p class="setting-help">适用于列表和预览中的单文件删除。批量删除、删除文件夹始终需要确认。</p>
          </div>
        </div>
      </section>
      <section v-show="category === 'shortcuts'" class="settings-section shortcut-settings">
        <h2>快捷键</h2>
        <p class="setting-help">预览快捷键在普通预览和全屏预览中都可用。输入文字或编辑生成信息时不会触发。下方直接列出每项的生效位置。</p>
        <div class="shortcut-table">
          <div class="shortcut-row shortcut-heading"><span>操作</span><span>按键</span><span>生效位置</span></div>
          <div v-for="item in fixedShortcuts" :key="item.keys" class="shortcut-row fixed-shortcut">
            <span>{{ item.action }}</span><div><kbd>{{ item.keys }}</kbd><small class="fixed-label">固定</small></div><span class="shortcut-scope">{{ item.scope }}</span>
          </div>
          <div v-for="item in shortcutsList" :key="item.key" class="shortcut-row" :class="{conflict:shortcutProblem(item.key)}">
            <span>{{ item.label }}</span><div class="shortcut-edit"><a-input :value="formatShortcut(globalStore.shortcut[item.key])" readonly :aria-label="`设置快捷键：${item.label}`" placeholder="点击后按下快捷键" @keydown.stop="onShortcutKeyDown($event,item.key)" /><a-button type="text" size="small" :disabled="!globalStore.shortcut[item.key]" :aria-label="`清除快捷键：${item.label}`" @click="globalStore.shortcut[item.key]=''; shortcutError=''">清除</a-button><small v-if="shortcutProblem(item.key)" class="shortcut-problem">{{ shortcutProblem(item.key) }}</small></div><span class="shortcut-scope">普通预览、全屏预览</span>
          </div>
        </div>
        <p v-if="shortcutError" role="status" class="shortcut-problem">{{ shortcutError }}</p>
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
.settings-navigation { margin-bottom:18px; }
.settings-section { width:100%; min-width:0; box-sizing:border-box; padding:24px; margin-bottom:16px; border:1px solid var(--zp-border); border-radius:8px; background:var(--zp-primary-background); }
@media(max-width:760px) { .panel {padding:16px;} .settings-section {padding:16px;} }

h2 {
  margin: 24px 0 20px;
  font-size:17px;
  font-weight:600;
  &:first-child {margin-top:0;}
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
.general-setting-row{display:grid;grid-template-columns:minmax(160px,220px) minmax(0,1fr);gap:16px;align-items:start;padding:18px 0;border-bottom:1px solid var(--zp-border);}
.general-setting-row:last-child{border-bottom:0;padding-bottom:0;}
.general-setting-row:first-of-type{padding-top:0;}
.general-setting-label{font-size:14px;font-weight:500;line-height:1.7;}
.general-setting-content{min-width:0;}
.general-setting-content>.setting-help:first-child{margin-top:0;}
.general-setting-content>.setting-help:last-child{margin-bottom:0;}
.language-control{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.lang-select-wrap{width:100%;min-width:0;flex:1;}
.lang-select-wrap :deep(.ant-select){width:100%;}
.general-settings :deep(.archive-settings>label){display:none;}
@container(max-width:650px){.settings-section :deep(.ant-form-item-row){grid-template-columns:minmax(0,1fr);gap:6px;}.settings-section :deep(.ant-form-item-label){padding:0;}.settings-navigation{gap:4px;}.settings-navigation button{padding:8px 12px;}}
@container(max-width:650px){.general-setting-row{grid-template-columns:minmax(0,1fr);gap:6px;}}

.setting-help{font-size:12px;color:var(--zp-secondary);line-height:1.7;margin:8px 0 16px;}.format-list{display:grid;grid-template-columns:48px 1fr;gap:10px;margin:12px 0;font-size:12px;}.format-list dt{color:var(--zp-secondary);}.format-list dd{margin:0;overflow-wrap:anywhere;}
.shortcut-table{display:flex;flex-direction:column;}.shortcut-row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(200px,1.3fr) minmax(130px,1fr);gap:16px;align-items:center;padding:12px 0;border-bottom:1px solid var(--zp-border);font-size:12px;}.shortcut-heading{color:var(--zp-secondary);font-weight:600;}.shortcut-row kbd{display:inline-block;padding:4px 7px;border:1px solid var(--zp-border);border-radius:5px;background:var(--zp-secondary-background);font:11px/1.5 ui-monospace,monospace;white-space:pre-wrap;}.fixed-label{margin-left:8px;font-size:10px;color:var(--zp-secondary);}.shortcut-scope{color:var(--zp-secondary);font-size:11px;}.shortcut-edit{display:flex;gap:4px;flex-wrap:wrap;}.shortcut-edit .ant-input{width:0;flex:1;min-width:110px;font-size:12px;cursor:pointer;}.shortcut-problem{color:#d4380d;font-size:11px;flex-basis:100%;}.shortcut-row.conflict{background:transparent!important;}@media(max-width:850px){.shortcut-row{grid-template-columns:1fr 1.3fr;gap:8px;}.shortcut-row>.shortcut-scope{grid-column:1/-1;}.shortcut-heading>span:last-child{display:none;}}
.panel{background:var(--ui-canvas);}
.settings-navigation{position:sticky;top:-24px;z-index:4;flex-wrap:nowrap;max-width:1100px;overflow-x:auto;scrollbar-width:none;padding:8px 0;margin:-8px 0 16px;background:var(--ui-canvas);}
.settings-navigation::-webkit-scrollbar{display:none;}
.settings-navigation button{flex-shrink:0;white-space:nowrap;font-size:13px;}
.settings-section{max-width:1100px;border-radius:var(--ui-radius-lg);box-shadow:0 3px 14px #213b5908;animation:settings-enter var(--ui-motion) var(--ui-ease);}
.settings-section h2{font-size:17px;letter-spacing:-.02em;}
@keyframes settings-enter{from{opacity:.72;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:760px){.settings-navigation{top:-16px;}}
</style>
