<script setup lang="ts">
import { computed, nextTick, ref, watch, useId } from 'vue'
import { useElementSize } from '@vueuse/core'
import { message } from 'ant-design-vue'
import { saveEditedImage, type FileNodeInfo, type ImageCropRect } from '@/api/files'
import { ScissorOutlined, CloseOutlined, CopyOutlined, SaveOutlined, UndoOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons-vue'

const props = defineProps<{ file: FileNodeInfo; src: string }>()
const emit = defineEmits<{ preview: []; saved: [file: FileNodeInfo, overwrite: boolean] }>()
const stage = ref<HTMLElement>()
const sourceImage = ref<HTMLImageElement>()
const resultCanvas = ref<HTMLCanvasElement>()
const { width: stageWidth, height: stageHeight } = useElementSize(stage)
const sourceWidth = ref(0)
const sourceHeight = ref(0)
const crop = ref<ImageCropRect>({ x: 0, y: 0, width: 1, height: 1 })
const ratioPreset = ref('free')
const stretch = ref(false)
const outputWidth = ref(0)
const outputHeight = ref(0)
const resultPreview = ref(false)
const saving = ref(false)
const saveMode = ref<'copy' | 'overwrite'>('copy')
const confirmingOverwrite = ref(false)
const error = ref('')
const ratioGroupName = useId()
function ratioShape(value: string) {
  const ratio = value === 'original' && sourceHeight.value
    ? sourceWidth.value / sourceHeight.value
    : value.includes(':') ? Number(value.split(':')[0]) / Number(value.split(':')[1]) : 1.3
  const height = Math.min(18, 20 / ratio)
  return { width: `${height * ratio}px`, height: `${height}px` }
}
const ratioOptions = [
  { value: 'free', label: '自由' }, { value: 'original', label: '原图比例' },
  { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' }, { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
]
const selectedRatio = computed(() => {
  if (ratioPreset.value === 'free' || !sourceWidth.value || !sourceHeight.value) return undefined
  if (ratioPreset.value === 'original') return sourceWidth.value / sourceHeight.value
  const [width, height] = ratioPreset.value.split(':').map(Number)
  return width / height
})
const cropPixelRatio = computed(() => (crop.value.width * sourceWidth.value) / Math.max(1, crop.value.height * sourceHeight.value))
const renderedSize = computed(() => {
  if (!sourceWidth.value || !sourceHeight.value) return { width: 0, height: 0 }
  const scale = Math.min((stageWidth.value - 48) / sourceWidth.value, (stageHeight.value - 120) / sourceHeight.value, 1)
  return { width: Math.max(1, sourceWidth.value * scale), height: Math.max(1, sourceHeight.value * scale) }
})
const resultDisplaySize = computed(() => {
  if (!validOutput.value) return { width: 0, height: 0 }
  const scale = Math.min((stageWidth.value - 48) / outputWidth.value, (stageHeight.value - 120) / outputHeight.value, 1)
  return { width: Math.max(1, outputWidth.value * scale), height: Math.max(1, outputHeight.value * scale) }
})
const selectionStyle = computed(() => ({
  left: `${crop.value.x * 100}%`, top: `${crop.value.y * 100}%`,
  width: `${crop.value.width * 100}%`, height: `${crop.value.height * 100}%`,
}))
const validOutput = computed(() => Number.isInteger(outputWidth.value) && Number.isInteger(outputHeight.value)
  && outputWidth.value > 0 && outputHeight.value > 0 && outputWidth.value <= 16384 && outputHeight.value <= 16384
  && outputWidth.value * outputHeight.value <= 100_000_000)
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function onImageLoad(event: Event) {
  const image = event.target as HTMLImageElement
  sourceWidth.value = image.naturalWidth
  sourceHeight.value = image.naturalHeight
  crop.value = { x: 0, y: 0, width: 1, height: 1 }
  ratioPreset.value = 'free'
  outputWidth.value = image.naturalWidth
  outputHeight.value = image.naturalHeight
  resultPreview.value = false
}
function setRatio(value: string) {
  ratioPreset.value = value
  const ratio = selectedRatio.value
  if (!ratio) return
  const imageRatio = sourceWidth.value / sourceHeight.value
  const width = Math.min(1, ratio / imageRatio)
  const height = Math.min(1, imageRatio / ratio)
  crop.value = { x: (1 - width) / 2, y: (1 - height) / 2, width, height }
  syncHeight()
}
function syncHeight() {
  if (!stretch.value && cropPixelRatio.value > 0) outputHeight.value = Math.max(1, Math.round(outputWidth.value / cropPixelRatio.value))
}
function setWidth(value: Event | number) {
  outputWidth.value = typeof value === 'number' ? value : Number((value.target as HTMLInputElement).value)
  syncHeight()
}
function setHeight(value: Event | number) {
  outputHeight.value = typeof value === 'number' ? value : Number((value.target as HTMLInputElement).value)
  if (!stretch.value && cropPixelRatio.value > 0) outputWidth.value = Math.max(1, Math.round(outputHeight.value * cropPixelRatio.value))
}
function stepDimension(dimension: 'width' | 'height', delta: number) {
  const current = dimension === 'width' ? outputWidth.value : outputHeight.value
  const value = clamp(Math.round(current || 0) + delta, 1, 16384)
  if (dimension === 'width') setWidth(value)
  else setHeight(value)
}
function setStretch(value: boolean) { stretch.value = value; if (!value) syncHeight() }
function resetCrop() { ratioPreset.value = 'free'; crop.value = { x: 0, y: 0, width: 1, height: 1 }; syncHeight() }

let drag: { kind: 'move' | 'resize'; start: ImageCropRect; x: number; y: number; anchor?: { x: number; y: number } } | undefined
function point(event: PointerEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) }
}
function beginCrop(event: PointerEvent) {
  if (event.button !== 0 || resultPreview.value || saving.value) return
  const frame = event.currentTarget as HTMLElement
  const at = point(event, frame)
  const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle
  const initial = { ...crop.value }
  if (handle === 'move') drag = { kind: 'move', start: initial, ...at }
  else {
    const anchor = handle ? {
      x: handle.includes('w') ? initial.x + initial.width : initial.x,
      y: handle.includes('n') ? initial.y + initial.height : initial.y,
    } : at
    drag = { kind: 'resize', start: initial, ...at, anchor }
  }
  frame.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function moveCrop(event: PointerEvent) {
  if (!drag || !sourceWidth.value) return
  const at = point(event, event.currentTarget as HTMLElement)
  if (drag.kind === 'move') {
    crop.value = { ...drag.start,
      x: clamp(drag.start.x + at.x - drag.x, 0, 1 - drag.start.width),
      y: clamp(drag.start.y + at.y - drag.y, 0, 1 - drag.start.height) }
  } else {
    const anchor = drag.anchor!
    const signX = at.x >= anchor.x && anchor.x < 1 ? 1 : -1
    const signY = at.y >= anchor.y && anchor.y < 1 ? 1 : -1
    let width = Math.max(.005, Math.abs(at.x - anchor.x))
    let height = Math.max(.005, Math.abs(at.y - anchor.y))
    if (selectedRatio.value) {
      const normalizedRatio = selectedRatio.value * sourceHeight.value / sourceWidth.value
      width = Math.max(width, height * normalizedRatio)
      height = width / normalizedRatio
    }
    const maxWidth = signX > 0 ? 1 - anchor.x : anchor.x
    const maxHeight = signY > 0 ? 1 - anchor.y : anchor.y
    const scale = Math.min(1, maxWidth / width, maxHeight / height)
    width = Math.max(.001, width * scale)
    height = Math.max(.001, height * scale)
    crop.value = { x: signX > 0 ? anchor.x : anchor.x - width, y: signY > 0 ? anchor.y : anchor.y - height, width, height }
    syncHeight()
  }
}
function endCrop(event: PointerEvent) {
  if (!drag) return
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  drag = undefined
}

function drawResult() {
  const image = sourceImage.value
  const canvas = resultCanvas.value
  if (!resultPreview.value || !image?.naturalWidth || !canvas || !validOutput.value) return
  const scale = Math.min(1200 / outputWidth.value, 1200 / outputHeight.value, 1)
  canvas.width = Math.max(1, Math.round(outputWidth.value * scale))
  canvas.height = Math.max(1, Math.round(outputHeight.value * scale))
  canvas.getContext('2d')?.drawImage(image,
    crop.value.x * image.naturalWidth, crop.value.y * image.naturalHeight,
    crop.value.width * image.naturalWidth, crop.value.height * image.naturalHeight,
    0, 0, canvas.width, canvas.height)
}
watch([resultPreview, crop, outputWidth, outputHeight], () => { void nextTick(drawResult) })
function requestExit() {
  if (saving.value) return
  if (confirmingOverwrite.value) { confirmingOverwrite.value = false; return }
  emit('preview')
}
defineExpose({ requestExit, saving })
function requestSave() {
  if (saveMode.value === 'overwrite') confirmingOverwrite.value = true
  else void save()
}
async function save() {
  if (!validOutput.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const overwrite = saveMode.value === 'overwrite'
    const { file } = await saveEditedImage(props.file.fullpath, crop.value, outputWidth.value, outputHeight.value, overwrite)
    message.success(overwrite ? '已覆盖原图' : `已保存副本：${file.name}`)
    emit('saved', file, overwrite)
  } catch (cause: any) {
    error.value = cause.response?.data?.detail || '保存失败，请检查文件权限和输出尺寸'
  } finally { saving.value = false }
}
</script>

<template>
  <div class="image-edit-workspace" role="region" aria-label="裁剪与缩放" :aria-busy="saving" @wheel.stop @touchstart.stop @touchmove.stop>
    <div ref="stage" class="edit-stage">
      <div class="edit-stage-content">
        <div v-show="!resultPreview" class="edit-image-frame" :style="{ width: `${renderedSize.width}px`, height: `${renderedSize.height}px` }"
          @pointerdown="beginCrop" @pointermove="moveCrop" @pointerup="endCrop" @pointercancel="endCrop">
          <img ref="sourceImage" :src="src" :alt="file.name" draggable="false" @load="onImageLoad" />
          <div v-if="sourceWidth" class="crop-selection" :style="selectionStyle">
            <div class="crop-move" data-handle="move" aria-label="移动裁剪区域" />
            <i v-for="corner in ['nw', 'ne', 'sw', 'se']" :key="corner" :class="`crop-${corner}`" :data-handle="corner" />
          </div>
        </div>
        <canvas v-show="resultPreview" ref="resultCanvas" class="result-canvas" aria-label="裁剪与缩放结果预览" :style="{width:`${resultDisplaySize.width}px`,height:`${resultDisplaySize.height}px`}" />
      </div>
      <div class="edit-stage-footer"><span :title="file.fullpath">{{ file.name }}</span><span>{{ resultPreview ? '结果预览' : '拖动边角裁剪，拖动框内移动' }}</span></div>
    </div>
    <aside class="edit-panel preview-panel-surface" aria-label="裁剪与缩放工具">
      <div class="edit-panel-header"><strong><ScissorOutlined /> 裁剪与缩放</strong><button type="button" :disabled="saving" aria-label="退出裁剪与缩放" title="退出裁剪与缩放（Esc）" @click="requestExit"><CloseOutlined /></button></div>
      <fieldset class="edit-fields" :disabled="saving">
      <section class="crop-controls">
        <div class="edit-section-heading"><h3>画面比例</h3><button type="button" class="reset-crop" title="使用完整画面" @click="resetCrop"><UndoOutlined />重置</button></div>
        <div class="ratio-presets" role="group" aria-label="裁剪比例">
          <label v-for="option in ratioOptions" :key="option.value" class="ratio-choice">
            <input type="radio" :name="ratioGroupName" :value="option.value" :checked="ratioPreset === option.value" @change="setRatio(option.value)" />
            <span><i class="ratio-shape" :class="{'ratio-free': option.value === 'free'}" :style="ratioShape(option.value)" aria-hidden="true" /><span>{{ option.value === 'original' ? '原比例' : option.label }}</span></span>
          </label>
        </div>
        <p v-if="sourceWidth" class="edit-dimensions">选区 {{ Math.round(crop.width * sourceWidth) }} × {{ Math.round(crop.height * sourceHeight) }} px</p>
      </section>
      <section>
        <div class="edit-section-heading"><h3>输出尺寸</h3><button type="button" class="result-preview-toggle" :disabled="!validOutput || saving" :aria-pressed="resultPreview" @click="resultPreview = !resultPreview">{{ resultPreview ? '继续调整' : '预览结果' }}</button></div>
        <div class="dimension-inputs">
          <div class="dimension-control">
            <label :for="`${ratioGroupName}-width`">宽度 <small>px</small></label>
            <div class="dimension-field">
              <button type="button" aria-label="减小宽度" :disabled="outputWidth <= 1" @click="stepDimension('width', -1)"><MinusOutlined /></button>
              <input :id="`${ratioGroupName}-width`" :value="outputWidth" type="number" min="1" max="16384" step="1" aria-label="输出宽度" @input="setWidth" />
              <button type="button" aria-label="增大宽度" :disabled="outputWidth >= 16384" @click="stepDimension('width', 1)"><PlusOutlined /></button>
            </div>
          </div>
          <span class="dimension-separator" aria-hidden="true">×</span>
          <div class="dimension-control">
            <label :for="`${ratioGroupName}-height`">高度 <small>px</small></label>
            <div class="dimension-field">
              <button type="button" aria-label="减小高度" :disabled="outputHeight <= 1" @click="stepDimension('height', -1)"><MinusOutlined /></button>
              <input :id="`${ratioGroupName}-height`" :value="outputHeight" type="number" min="1" max="16384" step="1" aria-label="输出高度" @input="setHeight" />
              <button type="button" aria-label="增大高度" :disabled="outputHeight >= 16384" @click="stepDimension('height', 1)"><PlusOutlined /></button>
            </div>
          </div>
        </div>
        <label class="aspect-switch"><span>保持比例</span><input type="checkbox" role="switch" :checked="!stretch" @change="setStretch(!($event.target as HTMLInputElement).checked)" /><i aria-hidden="true" /></label>
        <p class="edit-dimensions">{{ stretch ? '可独立调整宽高，画面会拉伸' : '按裁剪区域的比例同步调整' }}</p>
      </section>
      <section><h3>保存方式</h3><div class="save-mode-options"><label><input v-model="saveMode" type="radio" value="copy" @change="confirmingOverwrite = false" /><span><CopyOutlined />保存副本</span></label><label><input v-model="saveMode" type="radio" value="overwrite" @change="confirmingOverwrite = false" /><span><SaveOutlined />覆盖原图</span></label></div><p class="edit-note">{{ saveMode === 'copy' ? '原图保留，副本保存到同一目录。' : '替换原文件，保留标签和描述。' }}</p></section>
      </fieldset>
      <p v-if="error" class="edit-error" role="alert">{{ error }}</p>
      <div v-if="confirmingOverwrite" class="overwrite-confirm" role="alert"><p>确认替换原文件？此操作无法撤销。</p><div><button type="button" :disabled="saving" @click="confirmingOverwrite = false">取消</button><button type="button" class="primary" :disabled="saving || !validOutput" @click="save">{{ saving ? '保存中…' : '确认覆盖' }}</button></div></div>
      <div v-else class="edit-panel-actions"><button type="button" class="secondary" :disabled="saving" @click="requestExit">暂不保存</button><button type="button" class="primary" :disabled="!validOutput || saving || !sourceWidth" @click="requestSave">{{ saving ? '保存中…' : saveMode === 'copy' ? '保存副本' : '覆盖原图' }}</button></div>
    </aside>
  </div>
</template>

<style scoped>
.image-edit-workspace{position:absolute;inset:0;z-index:30;display:grid;grid-template-columns:minmax(0,1fr) var(--details-width,340px);color:#e5ebf3;font:13px/1.6 var(--ui-font);user-select:none;background:transparent}
.edit-stage{position:relative;min-width:0;min-height:0;overflow:hidden}
.edit-panel button{border:1px solid #ffffff20;border-radius:6px;background:#ffffff08;color:inherit;padding:5px 9px;min-height:30px;cursor:pointer;font:inherit;font-size:12px}
.edit-panel button:hover{background:#ffffff16;border-color:#8ac5f766}
.edit-panel .result-preview-toggle[aria-pressed=true]{background:#6caeff26;color:#a9d2ff}
.edit-stage-content{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:60px 24px;overflow:hidden;box-sizing:border-box}
.edit-image-frame{position:relative;flex:none;touch-action:none;cursor:crosshair}
.edit-image-frame>img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}
.crop-selection{position:absolute;box-sizing:border-box;border:2px solid #fff;box-shadow:0 0 0 100vmax #0008;pointer-events:none}
.crop-selection:before,.crop-selection:after{content:'';position:absolute;top:0;bottom:0;width:1px;background:#ffffff55;left:33.333%}
.crop-selection:after{left:66.666%}
.crop-move{position:absolute;inset:0;pointer-events:auto;cursor:move}
.crop-selection i{position:absolute;width:12px;height:12px;border:2px solid #fff;background:#1677c8;border-radius:2px;pointer-events:auto}
.crop-nw{left:-7px;top:-7px;cursor:nwse-resize}.crop-ne{right:-7px;top:-7px;cursor:nesw-resize}.crop-sw{left:-7px;bottom:-7px;cursor:nesw-resize}.crop-se{right:-7px;bottom:-7px;cursor:nwse-resize}
.result-canvas{max-width:100%;max-height:100%;object-fit:contain}
.edit-stage-footer{position:absolute;bottom:20px;left:20px;right:20px;display:flex;justify-content:space-between;gap:16px;color:#aeb9c8;font-size:12px;pointer-events:none}.edit-stage-footer span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.edit-panel{display:flex;flex-direction:column;gap:14px;min-height:0;overflow:auto;padding:16px;border-left:1px solid #ffffff18;background:#1c222a}
.edit-panel-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid #ffffff14;font-size:14px}.edit-panel-header strong>.anticon{color:#a9d2ff}.edit-panel-header button{width:30px;padding:0;display:grid;place-items:center}
.edit-fields{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:#ffffff26 transparent;display:flex;flex-direction:column;gap:14px;border:0;padding:0;margin:0;min-width:0}
.edit-note,.edit-dimensions{margin:0;color:#aeb9c8;font-size:12px;line-height:1.6}
.edit-panel section{flex-shrink:0;padding:14px;border:1px solid #ffffff12;border-radius:10px;background:#ffffff04}
.edit-panel h3{margin:0 0 12px;font-size:12px;font-weight:600;color:#cbd5e3}
.edit-panel label{display:flex;flex-direction:column;gap:7px;margin-bottom:10px}
.edit-panel select,.edit-panel input[type=number]{min-width:0;width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #ffffff24;border-radius:6px;background:#151b23;color:inherit;font:inherit;font-size:12px}
.dimension-inputs{display:grid;grid-template-columns:1fr 1fr;gap:8px}.edit-panel .stretch-option{flex-direction:row;align-items:center;gap:8px}.save-mode-options{display:flex;gap:12px}.save-mode-options label{flex-direction:row;align-items:center;gap:5px;font-size:12px}.edit-panel input[type=radio],.edit-panel input[type=checkbox]{accent-color:#6caeff}
.edit-panel button:disabled{opacity:.45;cursor:default}
.edit-error{padding:8px;color:#ff9b9b;background:#7d222233;border-radius:6px}
.edit-panel .result-preview-toggle{flex-shrink:0;border:0;background:transparent;color:#a9d2ff;border-radius:8px;padding:2px 6px;min-height:24px}
.edit-panel-actions{flex-shrink:0;display:flex;gap:8px;margin-top:auto;padding-top:10px}.edit-panel-actions button{flex:1}
.edit-panel button.primary{background:#1769aa;border-color:#1769aa;color:white}.edit-panel button.primary:hover{background:#227abb}
.overwrite-confirm{flex-shrink:0;margin-top:auto;padding:12px;border:1px solid #d7aa6355;border-radius:8px;background:#d7aa630d}.overwrite-confirm p{margin:0 0 10px;color:#edc994;font-size:12px}.overwrite-confirm>div{display:flex;justify-content:flex-end;gap:8px}
.image-edit-workspace :is(button,input,select):focus-visible{outline:2px solid #8ac5f7;outline-offset:2px}
@media(max-width:720px){.edit-panel{padding:10px}.edit-panel section{flex-shrink:0;padding:10px}.edit-stage-footer{left:10px;right:10px;flex-direction:column;gap:2px}.save-mode-options{flex-direction:column;gap:0}}
@media(max-width:560px){.image-edit-workspace{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(180px,1fr) minmax(220px,42vh)}.edit-panel{border-left:0;border-top:1px solid #ffffff18}.edit-stage-footer{bottom:6px;font-size:11px}}
</style>
