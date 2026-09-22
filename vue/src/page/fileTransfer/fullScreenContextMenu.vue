<script setup lang="ts">
import { getImageGenerationInfo, getImageExif } from '@/api'
import type { FileNodeInfo } from '@/api/files'
import ExifBrowser from '@/components/ExifBrowser.vue'
import DraggableImage from '@/components/DraggableImage.vue'
import { useGlobalStore } from '@/store/useGlobalStore'
import { useLocalStorage, useMediaQuery } from '@vueuse/core'
import type { MenuInfo } from 'ant-design-vue/lib/menu/src/interface'
import { debounce, throttle, last } from 'lodash-es'
import { computed, watch, onMounted } from 'vue'
import { ref } from 'vue'
import { copy2clipboardI18n, type Dict } from '@/util'
import { useResizeAndDrag } from './useResize'
import {
  DragOutlined,
  ArrowsAltOutlined,
  EditOutlined,
} from '@/icon'
import { t } from '@/i18n'
import { createReactiveQueue, unescapeHtml } from '@/util'
import ContextMenu from '@/components/ContextMenu.vue'
import { useWatchDocument } from 'vue3-ts-util'
import { useTagStore } from '@/store/useTagStore'
import { parse } from '@/util/stable-diffusion-image-metadata'
import { useFullscreenLayout } from '@/util/useFullscreenLayout'
import { useMouseInElement } from '@vueuse/core'
import { closeImageFullscreenPreview } from '@/util/imagePreviewOperation'
import { openAddNewTagModal, openEditPromptModal } from '@/components/functionalCallableComp'
import { prefix } from '@/util/const'
import * as Pinyin from 'jian-pinyin'
import { Tag } from '@/api/db'

const global = useGlobalStore()

const tagStore = useTagStore()
const el = ref<HTMLElement>()
const props = defineProps<{
  file: FileNodeInfo
  idx: number
}>()
const selectedTag = computed(() => tagStore.tagMap.get(props.file.fullpath) ?? [])
const currImgResolution = ref('')
const q = createReactiveQueue()
const imageGenInfo = ref('')
const exifData = ref<Record<string, string>>({})
const exifDataLoading = ref(false)
const cleanImageGenInfo = computed(() => imageGenInfo.value.replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;'))
const geninfoFrags = computed(() => cleanImageGenInfo.value.split('\n'))
const geninfoStruct = computed(() => parse(cleanImageGenInfo.value))

const geninfoStructNoPrompts = computed(() => {
  const p = parse(cleanImageGenInfo.value)
  delete p.prompt
  delete p.negativePrompt
  delete p.extraJsonMetaInfo
  return p
})

// extraJsonMetaInfo 是需要额外显示的meta字段，使用原始 imageGenInfo 解析以避免 HTML 转义问题
const extraJsonMetaInfo = computed(() => {
  const p = parse(imageGenInfo.value) // 使用原始的 imageGenInfo，而不是 cleanImageGenInfo
  return p.extraJsonMetaInfo as Record<string, any> | undefined
})

const emit = defineEmits<{
  (type: 'contextMenuClick', e: MenuInfo, file: FileNodeInfo, idx: number): void
}>()

const promptTabActivedKey = useLocalStorage('iib@fullScreenContextMenu.prompt-tab', 'structedData' as 'structedData' | 'sourceText' | 'exif')

async function loadExifData() {
  if (!props?.file?.fullpath) {
    return
  }
  exifDataLoading.value = true
  try {
    exifData.value = await getImageExif(props.file.fullpath)
  } catch (error) {
    console.error('Failed to get EXIF data:', error)
  } finally {
    exifDataLoading.value = false
  }
}

watch(
  () => props?.file?.fullpath,
  async (path) => {
    if (!path) {
      return
    }
    q.tasks.forEach((v) => v.cancel())
    q.pushAction(() => getImageGenerationInfo(path)).res.then((v) => {
      imageGenInfo.value = v
    })
    exifData.value = {}
    if (promptTabActivedKey.value === 'exif') {
      loadExifData()
    }
  },
  { immediate: true }
)

watch(promptTabActivedKey, async (tabKey) => {
  if (tabKey === 'exif') {
    loadExifData()
  }
})

onMounted(() => {
  if (promptTabActivedKey.value === 'exif' && props?.file?.fullpath) {
    loadExifData()
  }
})

const resizeHandle = ref<HTMLElement>()
const dragHandle = ref<HTMLElement>()
const dragInitParams = {
  left: 100,
  top: 100,
  width: 512,
  height: 384,
  expanded: true
}
const state = useLocalStorage('fullScreenContextMenu.vue-drag', dragInitParams)
if (state.value && (state.value.left < 0 || state.value.top < 0)) {
  state.value = { ...dragInitParams }
}


const { isLeftRightLayout, lrLayoutInfoPanelWidth, lrMenuAlwaysOn } = useFullscreenLayout()
const lr = isLeftRightLayout
useResizeAndDrag(el, resizeHandle, dragHandle, {
  disbaled: lr,
  ...state.value,
  onDrag: debounce(function (left, top) {
    state.value = {
      ...state.value,
      left,
      top
    }
  }, 300),
  onResize: debounce(function (width, height) {
    state.value = {
      ...state.value,
      width,
      height
    }
  }, 300)
})


// 处理在isOutside赋值前引用
const isInside = ref(false)

const { isOutside } = useMouseInElement(computed(() => {
  if (!lr.value || lrMenuAlwaysOn.value) {
    return null as any
  }

  const isIn = isInside.value as boolean
  return isIn ? el.value : last(document.querySelectorAll('.iib-tab-edge-trigger'))
}))


watch(isOutside, throttle((v) => {
  isInside.value = !v
}, 300))



function getTextLength(text: string): number {
  // chinese characters are counted as 3 English letters
  let length = 0
  for (const char of text) {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      length += 3
    } else {
      length += 1
    }
  }
  return length
}

function isTagStylePrompt(tags: string[]): boolean {
  if (tags.length === 0) return false

  let totalLength = 0
  for (const tag of tags) {
    const tagLength = getTextLength(tag)
    totalLength += tagLength

    // 如果存在长度大于50的tag，返回false（自然语言）
    if (tagLength > 50) {
      return false
    }
  }

  // 如果平均长度大于30，返回false（自然语言）
  const avgLength = totalLength / tags.length
  if (avgLength > 30) {
    return false
  }

  return true
}

function spanWrap (text: string) {
  if (!text) {
    return ''
  }

  const specBreakTag = 'BREAK'
  const values = text.replace(/&gt;\s/g, '> ,').replace(/\sBREAK\s/g, ',' + specBreakTag + ',').split(/[\n,]+/).map(v => v.trim()).filter(v => v)
  // 判断是否为tag形式
  if (!isTagStylePrompt(values)) {
    // 自然语言形式：直接显示，保留段落结构
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line)
      .map(line => `<p class="natural-text">${line}</p>`)
      .join('')
  }

  // Tag形式：使用原有的标签样式
  const frags = [] as string[]
  let parenthesisActive = false
  for (let i = 0; i < values.length; i++) {
    if (values[i] === specBreakTag) {
      frags.push('<br><span class="tag" style="color:var(--zp-secondary)">BREAK</span><br>')
      continue

    }
    const trimmedValue = values[i]
    if (!parenthesisActive) parenthesisActive = trimmedValue.includes('(')
    const classList = ['tag']
    if (parenthesisActive) classList.push('has-parentheses')
    if (trimmedValue.length < 32) classList.push('short-tag')

    frags.push(`<span class="${classList.join(' ')}">${trimmedValue}</span>`)
    if (parenthesisActive) parenthesisActive = !trimmedValue.includes(')')
  }
  return frags.join(global.showCommaInInfoPanel ? ',' : ' ')
}

useWatchDocument('load', e => {
  const el = e.target as HTMLImageElement
  if (el.className === 'ant-image-preview-img') {
    currImgResolution.value = `${el.naturalWidth} x ${el.naturalHeight}`
  }
}, { capture: true })

const baseInfoTags = computed(() => {
  const tags: { val: string, name: string }[] = [{ name: t('fileSize'), val: props.file.size }]
  if (currImgResolution.value) {
    tags.push({ name: t('resolution'), val: currImgResolution.value })
  }
  return tags
})

const copyPositivePrompt = () => {
  const neg = 'Negative prompt:'
  const text = imageGenInfo.value.includes(neg) ? imageGenInfo.value.split(neg)[0] : geninfoFrags.value[0] ?? ''
  copy2clipboardI18n(unescapeHtml(text.trim()))
}
const requestFullscreen = () => document.body.requestFullscreen()

const copy = (val: any) => {
  copy2clipboardI18n(typeof val === 'object' ? JSON.stringify(val, null, 4) : val)
}



const onKeydown = (e: KeyboardEvent) => {
  if (e.key.startsWith('Arrow')) {
    e.stopPropagation()
    e.preventDefault()
    document.dispatchEvent(new KeyboardEvent('keydown', e))
  }
  else if (e.key === 'Escape') {
    // 判断是不是全屏如果是退出
    if (document.fullscreenElement) {
      document.exitFullscreen()
    }

  }
}

useWatchDocument('dblclick', e => {
  if ((e.target as HTMLDivElement)?.className === 'ant-image-preview-img') {
    closeImageFullscreenPreview()
  }
})


const isCompactPreview = useMediaQuery('(max-width: 760px)')
const showFullContent = computed(() => isCompactPreview.value || lr.value || state.value.expanded)
const showFullPath = useLocalStorage(prefix + 'contextShowFullPath', false)
const previewOptionsOpen = ref(false)

const tagA2ZClassify = useLocalStorage(prefix + 'tagA2ZClassify', false)
const tagAlphabet = computed(() => {
  const tags = global.conf?.all_custom_tags.map(v => {
    const char = v.display_name?.[0] || v.name?.[0]
    return {
      char,
      ...v
    }
  }).reduce((p: Dict<Tag[]>, c: Tag & { char: string }) => {
    let pos = '#'
    if (/[a-z]/i.test(c.char)) {
      pos = c.char.toUpperCase()
    } else if (/[\u4e00-\u9fa5]/.test(c.char)) {
      try {
        pos = /^\[?(\w)/.exec((Pinyin.getSpell(c.char) + ''))?.[1] ?? '#'

      } catch (error) {
        console.log('err', error)
      }
    }
    pos = pos.toUpperCase()
    p[pos] ||= []
    p[pos].push(c)
    return p
  }, {} as Dict<Tag[]>)
  const res = Object.entries(tags ?? {}).sort((a, b) => a[0].charCodeAt(0) - b[0].charCodeAt(0))
  return res
})

// 抖音风格浏览处理函数
const onTiktokViewClick = () => {
  // 从当前文件开始浏览，需要获取当前文件所在的文件列表
  // 这里我们只能浏览单个文件，因为没有完整的文件列表上下文
  closeImageFullscreenPreview()
  emit('contextMenuClick', { key: 'tiktokView' } as any, props.file, props.idx)
}

// 编辑提示词并重新加载
const editPromptAndReload = async () => {
  await openEditPromptModal(props.file)
  const path = props.file?.fullpath
  if (path) {
    q.tasks.forEach((v) => v.cancel())
    q.pushAction(() => getImageGenerationInfo(path)).res.then((v) => {
      imageGenInfo.value = v
    })
  }
}

</script>

<template>
  <div ref="el" class="full-screen-menu" @wheel.capture.stop @keydown.capture="onKeydown"
    :class="{ 'unset-size': !state.expanded, lr, 'always-on': lrMenuAlwaysOn, 'mouse-in': isInside }">


    <div class="container">
      <header class="preview-header">
        <strong ref="dragHandle" :class="{ 'drag-handle': !lr }" :title="!lr ? t('dragToMovePanel') : undefined">图片信息</strong>
        <div class="preview-header-actions">
          <a-button v-if="!lr" class="collapse-info" type="text" size="small" @click="state.expanded = !state.expanded">{{ state.expanded ? '收起' : '展开' }}</a-button>
          <a-button type="text" size="small" @click="previewOptionsOpen = true">查看选项</a-button>
          <a-button type="text" size="small" @click="closeImageFullscreenPreview">关闭预览</a-button>
        </div>
      </header>
      <div v-if="global.fullscreenMenuBlockVisibility.actionBar" class="preview-actions">
        <a-dropdown :trigger="['click']" :overlay-style="{ zIndex: 10010 }">
          <a-button>文件操作</a-button>
          <template #overlay>
            <context-menu :file="file" :idx="idx" :selected-tag="selectedTag"
              @context-menu-click="(e, f, i) => emit('contextMenuClick', e, f, i)" />
          </template>
        </a-dropdown>
        <a-button @click="emit('contextMenuClick', { key: 'download' } as MenuInfo, file, idx)">保存原图</a-button>
        <a-button @click="onTiktokViewClick">逐张浏览</a-button>
        <a-button @click="editPromptAndReload">编辑生成信息</a-button>
      </div>
      <div class="gen-info" v-if="showFullContent">
        <section v-if="global.fullscreenMenuBlockVisibility.infoTags" class="preview-file-info">
          <div class="section-heading"><h3>文件信息</h3><a-button type="text" size="small" @click="showFullPath = !showFullPath">{{ showFullPath ? '收起路径' : '显示路径' }}</a-button></div>
          <p class="preview-file-name" :title="file.name" @dblclick="copy2clipboardI18n(file.name)">{{ file.name }}</p>
          <p v-if="showFullPath" class="preview-file-path" @dblclick="copy2clipboardI18n(file.fullpath)">{{ file.fullpath }}</p>
          <dl class="preview-file-details">
            <div v-for="tag in baseInfoTags" :key="tag.name"><dt>{{ tag.name }}</dt><dd @dblclick="copy2clipboardI18n(tag.val)">{{ tag.val }}</dd></div>
          </dl>
        </section>
        <div block class="tags-container" v-if="global.conf?.all_custom_tags && global.fullscreenMenuBlockVisibility.tagsContainer">
          <div class="section-heading"><h3>标签</h3><div class="section-actions">
            <a-button type="text" size="small" @click="tagA2ZClassify = !tagA2ZClassify">{{ tagA2ZClassify ? '平铺标签' : '按名称分组' }}</a-button>
            <a-button size="small" @click="openAddNewTagModal">新增标签</a-button>
          </div></div>
          <p v-if="!global.conf.all_custom_tags.length" class="preview-muted">暂无标签，可新建标签整理图片。</p>
          <template v-if="tagA2ZClassify">
            <div v-for="([char, item]) in tagAlphabet" :key="char" class="tag-alpha-item">
              <h4 style="display: inline-block; width: 32px;">{{ char }} : </h4>
              <div><div class="tag" v-for="tag in item"
                @click="emit('contextMenuClick', { key: `toggle-tag-${tag.id}` } as any, file, idx)"
                :class="{ selected: selectedTag.some(v => v.id === tag.id) }" :key="tag.id"
                :style="{ '--tag-color': tagStore.getColor(tag) }">
                {{ tag.name }}
              </div></div>
            </div>
          </template>
          <template v-else>

            <div class="tag" v-for="tag in global.conf.all_custom_tags"
              @click="emit('contextMenuClick', { key: `toggle-tag-${tag.id}` } as any, file, idx)"
              :class="{ selected: selectedTag.some(v => v.id === tag.id) }" :key="tag.id"
              :style="{ '--tag-color': tagStore.getColor(tag) }">
              {{ tag.name }}
            </div>
          </template>
        </div>
        <details v-if="global.fullscreenMenuBlockVisibility.draggableImage" class="preview-transfer">
          <summary>拖出原图到其他应用</summary>
          <DraggableImage :file="file"><div class="custom-drag-trigger"><DragOutlined /><span>按住此处拖出原图</span></div></DraggableImage>
        </details>
        <div v-if="imageGenInfo && global.fullscreenMenuBlockVisibility.tabs" class="preview-copy-actions">
          <a-button size="small" @click="copy2clipboardI18n(imageGenInfo)">复制生成信息</a-button>
          <a-button size="small" @click="copyPositivePrompt">复制正向提示词</a-button>
        </div>
        <a-tabs block v-if="global.fullscreenMenuBlockVisibility.tabs" v-model:activeKey="promptTabActivedKey">
          <a-tab-pane key="structedData" tab="生成信息">
            <p v-if="!imageGenInfo" class="preview-muted">这张图片没有生成信息。</p>
            <div>
              <template v-if="geninfoStruct.prompt">
                <br />
                <div class="section-header">
                  <h3>正向提示词</h3>
                  <button
                    class="edit-section-btn"
                    @click="editPromptAndReload"
                    :title="$t('editPrompt')"
                  >
                    <EditOutlined />
                  </button>
                </div>
                <code v-html="spanWrap(geninfoStruct.prompt ?? '')"></code>
              </template>
              <template v-if="geninfoStruct.negativePrompt">
                <br />
                <div class="section-header">
                  <h3>反向提示词</h3>
                  <button
                    class="edit-section-btn"
                    @click="editPromptAndReload"
                    :title="$t('editPrompt')"
                  >
                    <EditOutlined />
                  </button>
                </div>
                <code v-html="spanWrap(geninfoStruct.negativePrompt ?? '')"></code>
              </template>
            </div>
            <template v-if="Object.keys(geninfoStructNoPrompts).length"> <br />
              <div class="section-header">
                <h3>生成参数</h3>
                <button
                  class="edit-section-btn"
                  @click="editPromptAndReload"
                  :title="$t('editPrompt')"
                >
                  <EditOutlined />
                </button>
              </div>
              <table>
                <tr v-for="txt, key in geninfoStructNoPrompts" :key="key" class="gen-info-frag">
                  <td style="font-weight: 600;text-transform: capitalize;">{{ key }}</td>
                  <td style="cursor: pointer;" v-if="typeof txt == 'object'" @dblclick="copy(txt)">
                    <code>{{ txt }}</code>
                  </td>
                  <td v-else style="cursor: pointer;" @dblclick="copy(unescapeHtml(txt))">
                    {{ unescapeHtml(txt) }}
                  </td>
                </tr>
              </table>
            </template>
            <template v-if="extraJsonMetaInfo && Object.keys(extraJsonMetaInfo).length"> <br />
              <div class="section-header">
                <h3>其他元数据</h3>
                <button
                  class="edit-section-btn"
                  @click="editPromptAndReload"
                  :title="$t('editPrompt')"
                >
                  <EditOutlined />
                </button>
              </div>
              <table class="extra-meta-table">
                <tr v-for="(val, key) in extraJsonMetaInfo" :key="key" class="gen-info-frag">
                  <td style="font-weight: 600;text-transform: capitalize;">{{ key }}</td>
                  <td style="cursor: pointer;" @dblclick="copy(val)">
                    <code class="extra-meta-value">{{ typeof val === 'string' ? val : JSON.stringify(val, null, 2) }}</code>
                  </td>
                </tr>
              </table>
            </template>
          </a-tab-pane>
          <a-tab-pane key="sourceText" tab="原始文本">
            <code v-if="imageGenInfo">{{ imageGenInfo }}</code><p v-else class="preview-muted">这张图片没有原始生成信息。</p>
          </a-tab-pane>
          <a-tab-pane key="exif" tab="拍摄信息">
            <a-spin :spinning="exifDataLoading">
              <div v-if="exifData && Object.keys(exifData).length">
                <ExifBrowser :data="exifData" />
              </div>
              <div v-else-if="!exifDataLoading">
                <p class="preview-muted">这张图片没有拍摄信息（EXIF）。</p>
              </div>
            </a-spin>
          </a-tab-pane>
        </a-tabs>
      </div>
    </div>

    <div class="mouse-sensor" ref="resizeHandle" v-if="state.expanded && !lr" :title="t('dragToResizePanel')">
      <ArrowsAltOutlined />
    </div>
  </div>
  <a-modal v-model:open="previewOptionsOpen" title="预览选项" :width="480" :footer="null" :z-index="10020">
    <a-form layout="vertical" :colon="false">
      <a-form-item label="窗口显示"><a-button @click="requestFullscreen">进入全屏</a-button></a-form-item>
      <a-form-item label="图片与信息并排显示" class="preview-desktop-option"><a-switch v-model:checked="lr" /></a-form-item>
      <template v-if="lr">
        <a-form-item label="信息栏宽度" class="preview-desktop-option"><a-input-number v-model:value="lrLayoutInfoPanelWidth" :step="16" :min="280" :max="1024" addon-after="像素" /></a-form-item>
        <a-form-item label="始终显示信息栏" class="preview-desktop-option"><a-switch v-model:checked="lrMenuAlwaysOn" /></a-form-item>
      </template>
      <a-form-item label="显示内容">
        <div class="preview-visibility-options">
          <template v-for="(_, key) in global.fullscreenMenuBlockVisibility" :key="key">
            <a-checkbox v-if="key !== 'lrLayoutControl'" v-model:checked="global.fullscreenMenuBlockVisibility[key]">{{ $t(`blockName_${key}`) }}</a-checkbox>
          </template>
        </div>
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<style scoped lang="scss">
.full-screen-menu {
  position: fixed;
  z-index: 9999;
  background: var(--zp-primary-background);
  padding: 8px 16px;
  box-shadow: 0px 0px 4px var(--zp-secondary);
  border-radius: 4px;

  .tags-container {
    margin: 4px 0;

    .tag {
      margin-right: 4px;
      margin-bottom: 4px;
      padding: 2px 16px;
      border-radius: 4px;
      display: inline-block;
      cursor: pointer;
      font-weight: bold;
      transition: .5s all ease;
      border: 2px solid var(--tag-color);
      color: var(--tag-color);
      background: var(--zp-primary-background);
      user-select: none;

      &.selected {
        background: var(--tag-color);
        color: white;
      }
    }
  }

  .container {
    height: 100%;
    display: flex;
    overflow: hidden;
    flex-direction: column;
  }

  .gen-info {
    padding-top: 8px;
    flex: 1;
    word-break: break-all;
    white-space: pre-line;
    overflow: auto;
    z-index: 1;
    padding-top: 4px;
    position: relative;

    code {
      font-size: 0.9em;
      display: block;
      padding: 4px;
      background: var(--zp-primary-background);
      border-radius: 4px;
      margin-right: 20px;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.78em;

      :deep() {
        .natural-text {
          margin: 0.5em 0;
          line-height: 1.6em;
          color: var(--zp-primary);
        }

        .short-tag {
          word-break: break-all;
          white-space: nowrap;
        }

        span.tag {

          background: var(--zp-secondary-variant-background);
          color: var(--zp-primary);
          padding: 2px 4px;
          border-radius: 6px;
          margin-right: 6px;
          margin-top: 4px;
          line-height: 1.3em;
          display: inline-block;
        }

        .has-parentheses.tag {
          background: rgba(255, 100, 100, 0.14);
        }

        span.tag:hover {
          background: rgba(120, 0, 0, 0.15);
        }
      }
    }

    table {
      font-size: 1em;
      border-radius: 4px;
      border-collapse: separate;
      margin-bottom: 3em;

      tr td:first-child {
        white-space: nowrap;
        vertical-align: top;
      }
    }

    table.extra-meta-table {
      .extra-meta-value {
        display: block;
        max-height: 200px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.85em;
        background: var(--zp-secondary-variant-background);
        padding: 8px;
        border-radius: 4px;
      }
    }

    table td {
      padding-right: 14px;
      padding-left: 4px;
      border-bottom: 1px solid var(--zp-secondary);
      border-collapse: collapse;
    }


  }

  &.unset-size {
    width: unset !important;
    height: unset !important;
  }

  .mouse-sensor {
    position: absolute;
    bottom: 0;
    right: 0;
    transform: rotate(90deg);
    cursor: se-resize;
    z-index: 1;
    background: var(--zp-primary-background);
    border-radius: 2px;

    &>* {
      font-size: 18px;
      padding: 4px;
    }
  }


}

.full-screen-menu.lr {
  top: v-bind("lrMenuAlwaysOn ? 0 : '46px'") !important;
  right: 0 !important;
  bottom: 0 !important;
  left: 100vw !important;
  height: unset !important;
  width: v-bind("`min(${lrLayoutInfoPanelWidth}px, 45vw)`") !important;
  transition: left ease 0.3s;

  &.always-on,
  &.mouse-in {
    left: v-bind("`calc(100vw - min(${lrLayoutInfoPanelWidth}px, 45vw))`") !important;
  }
}
.tag-alpha-item {
  display: flex;
  h4 {
    width: 32px;
    flex-shrink: 0;
  }
  margin-top: 4px;
}




.section-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  gap: 6px;

  h3 {
    margin: 0;
  }

  .edit-section-btn {
    margin: 0;
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: var(--zp-primary);
    font-size: 12px;
    line-height: 1;
    min-width: 22px;
    min-height: 22px;

    &:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.25);
      color: var(--zp-luminous);
      transform: scale(1.05);
    }

    &:active {
      transform: scale(0.95);
    }

    :deep(.anticon) {
      font-size: 12px;
    }
  }
}



.full-screen-menu .action-bar{flex-wrap:wrap;flex-shrink:0;gap:6px;}
.full-screen-menu .action-bar button{height:auto;min-height:28px;white-space:normal;}
.full-screen-menu .container{min-width:0;min-height:0;}.full-screen-menu .gen-info{min-height:0;}
.full-screen-menu:not(.lr){max-width:calc(100vw - 32px);max-height:calc(100dvh - 48px);}
@media(max-width:760px){
 .full-screen-menu,.full-screen-menu.lr,.full-screen-menu.lr.always-on,.full-screen-menu.lr.mouse-in,.full-screen-menu.unset-size{left:0!important;right:0!important;top:auto!important;bottom:0!important;width:100vw!important;height:42dvh!important;max-width:100vw;max-height:42dvh;border-radius:10px 10px 0 0;}
 .full-screen-menu .lr-layout-control{display:none;}
 .full-screen-menu .action-bar{gap:4px;}
}
</style>

<style scoped lang="scss">
.full-screen-menu {
  padding: 0;
  .container { min-height: 0; }
  .preview-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--zp-border); flex-shrink: 0; }
  .preview-header strong { font-size: 15px; }
  .drag-handle { cursor: grab; }
  .preview-header-actions, .section-actions, .preview-copy-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .preview-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--zp-border); flex-shrink: 0; }
  .preview-actions .ant-btn { height: auto; min-height: 34px; margin: 0; white-space: normal; }
  .gen-info { padding: 0 16px 16px; white-space: normal; word-break: normal; overflow-wrap: anywhere; }
  .section-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  h3 { font-size: 14px; margin: 0; }
  .preview-file-info, .tags-container { padding: 14px 0; margin: 0; border-bottom: 1px solid var(--zp-border); }
  .preview-file-name { font-weight: 500; margin: 0 0 10px; overflow-wrap: anywhere; }
  .preview-file-path { padding: 8px; border-radius: 6px; background: var(--zp-secondary-variant-background); font-size: 12px; }
  .preview-file-details { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 0; }
  .preview-file-details > div { display: flex; gap: 8px; }
  .preview-file-details dt, .preview-muted { color: var(--zp-secondary); }
  .preview-file-details dd { margin: 0; }
  .preview-muted { margin: 8px 0; line-height: 1.7; }
  .tags-container .tag { font-weight: 400; padding: 3px 10px; border-width: 1px; max-width: 100%; overflow-wrap: anywhere; }
  .preview-transfer { padding: 12px 0; border-bottom: 1px solid var(--zp-border); }
  .preview-transfer summary { cursor: pointer; color: var(--zp-secondary); }
  .custom-drag-trigger { margin-top: 10px; padding: 10px; min-height: 0; background: var(--zp-secondary-variant-background); box-shadow: none; font-size: 13px; gap: 8px; }
  .preview-copy-actions { padding-top: 12px; }
  .gen-info code { margin: 0; }
  .gen-info table { width: 100%; table-layout: fixed; margin-bottom: 16px; }
  .gen-info table td { white-space: normal; overflow-wrap: anywhere; }
  .gen-info :deep(.short-tag) { white-space: normal; }
}
.preview-visibility-options { display: flex; flex-direction: column; gap: 12px; }
.preview-visibility-options .ant-checkbox-wrapper { margin-inline-start: 0; }
@media (max-width: 760px) {
  .full-screen-menu .preview-header { padding: 8px 12px; }
  .full-screen-menu .preview-actions { grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 8px 12px; gap: 6px; }
  .full-screen-menu .preview-actions .ant-btn { font-size: 12px; padding: 4px; }
  .full-screen-menu .collapse-info, .preview-desktop-option { display: none; }
  .full-screen-menu .gen-info { padding-inline: 12px; }
}
</style>
