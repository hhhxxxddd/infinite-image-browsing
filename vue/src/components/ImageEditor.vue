<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import { message } from 'ant-design-vue'
import { saveEditedImage, type FileNodeInfo, type ImageCropRect } from '@/api/files'

const props = defineProps<{ file: FileNodeInfo; src: string }>()
const emit = defineEmits<{ preview: []; close: []; saved: [file: FileNodeInfo] }>()
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
const error = ref('')
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
  const scale = Math.min((stageWidth.value - 48) / sourceWidth.value, (stageHeight.value - 100) / sourceHeight.value, 1)
  return { width: Math.max(1, sourceWidth.value * scale), height: Math.max(1, sourceHeight.value * scale) }
})
const resultDisplaySize = computed(() => {
  if (!validOutput.value) return { width: 0, height: 0 }
  const scale = Math.min((stageWidth.value - 48) / outputWidth.value, (stageHeight.value - 100) / outputHeight.value)
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
function setWidth(event: Event) {
  outputWidth.value = Number((event.target as HTMLInputElement).value)
  syncHeight()
}
function setHeight(event: Event) {
  outputHeight.value = Number((event.target as HTMLInputElement).value)
  if (!stretch.value && cropPixelRatio.value > 0) outputWidth.value = Math.max(1, Math.round(outputHeight.value * cropPixelRatio.value))
}
function setStretch(value: boolean) { stretch.value = value; if (!value) syncHeight() }
function resetCrop() { ratioPreset.value = 'free'; crop.value = { x: 0, y: 0, width: 1, height: 1 }; syncHeight() }

let drag: { kind: 'move' | 'resize'; start: ImageCropRect; x: number; y: number; anchor?: { x: number; y: number } } | undefined
function point(event: PointerEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) }
}
function beginCrop(event: PointerEvent) {
  if (event.button !== 0 || resultPreview.value) return
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
async function save() {
  if (!validOutput.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const { file } = await saveEditedImage(props.file.fullpath, crop.value, outputWidth.value, outputHeight.value)
    message.success(`已保存副本：${file.name}`)
    emit('saved', file)
  } catch (cause: any) {
    error.value = cause.response?.data?.detail || '保存失败，请检查文件权限和输出尺寸'
  } finally { saving.value = false }
}
</script>

<template>
  <div class="image-edit-workspace" role="dialog" aria-label="编辑图片" @wheel.stop @touchstart.stop @touchmove.stop>
    <div ref="stage" class="edit-stage">
      <div class="edit-stage-header"><button type="button" @click="emit('preview')">← 返回预览</button><strong>编辑图片</strong><span :title="file.fullpath">{{ file.name }}</span></div>
      <div class="edit-stage-content">
        <div v-show="!resultPreview" class="edit-image-frame" :style="{ width: `${renderedSize.width}px`, height: `${renderedSize.height}px` }"
          @pointerdown="beginCrop" @pointermove="moveCrop" @pointerup="endCrop" @pointercancel="endCrop">
          <img ref="sourceImage" :src="src" :alt="file.name" draggable="false" @load="onImageLoad" />
          <div v-if="sourceWidth" class="crop-selection" :style="selectionStyle">
            <div class="crop-move" data-handle="move" aria-label="移动裁剪区域" />
            <i v-for="corner in ['nw', 'ne', 'sw', 'se']" :key="corner" :class="`crop-${corner}`" :data-handle="corner" />
          </div>
        </div>
        <canvas v-show="resultPreview" ref="resultCanvas" class="result-canvas" aria-label="编辑结果预览" :style="{width:`${resultDisplaySize.width}px`,height:`${resultDisplaySize.height}px`}" />
      </div>
      <div class="edit-stage-footer">{{ resultPreview ? '结果预览（最长边最多显示 1200 像素）' : '拖动图片创建裁剪框，拖动边角调整，拖动框内移动' }}</div>
    </div>
    <aside class="edit-panel" aria-label="编辑工具">
      <div class="edit-panel-header"><strong>编辑</strong><button type="button" aria-label="关闭编辑与预览" @click="emit('close')">×</button></div>
      <p class="edit-note">原图会保留，编辑结果保存为同目录副本。</p>
      <section><h3>裁剪</h3><label>画面比例<select :value="ratioPreset" aria-label="裁剪比例" @change="setRatio(($event.target as HTMLSelectElement).value)"><option v-for="option in ratioOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><button type="button" class="secondary" @click="resetCrop">使用完整画面</button><p v-if="sourceWidth" class="edit-dimensions">选区约 {{ Math.round(crop.width * sourceWidth) }} × {{ Math.round(crop.height * sourceHeight) }} 像素</p></section>
      <section><h3>缩放</h3><div class="dimension-inputs"><label>宽度 <input :value="outputWidth" type="number" min="1" max="16384" aria-label="输出宽度" @input="setWidth" /></label><label>高度 <input :value="outputHeight" type="number" min="1" max="16384" aria-label="输出高度" @input="setHeight" /></label></div><label class="stretch-option"><input type="checkbox" :checked="stretch" @change="setStretch(($event.target as HTMLInputElement).checked)" />拉伸到指定宽高</label><p class="edit-dimensions">{{ stretch ? '宽高可独立调整' : '保持裁剪区域的宽高比例' }}</p></section>
      <section><h3>查看</h3><button type="button" class="secondary" :disabled="!validOutput" @click="resultPreview = !resultPreview">{{ resultPreview ? '调整裁剪' : '查看结果' }}</button></section>
      <p v-if="error" class="edit-error" role="alert">{{ error }}</p>
      <div class="edit-panel-actions"><button type="button" class="secondary" :disabled="saving" @click="emit('preview')">返回预览</button><button type="button" class="primary" :disabled="!validOutput || saving || !sourceWidth" @click="save">{{ saving ? '保存中…' : '保存副本' }}</button></div>
    </aside>
  </div>
</template>

<style scoped>
.image-edit-workspace{position:absolute;inset:0;z-index:30;display:grid;grid-template-columns:minmax(0,1fr) 320px;background:#0d0f12;color:#e8ebef;font-size:13px;user-select:none}.edit-stage{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;background:#08090b}.edit-stage-header{display:flex;align-items:center;gap:14px;height:62px;padding:0 22px;background:#14171b;border-bottom:1px solid #ffffff20}.edit-stage-header button,.edit-panel button{border:1px solid #ffffff30;border-radius:6px;background:#ffffff0b;color:inherit;padding:7px 10px;cursor:pointer;font:inherit}.edit-stage-header button:hover,.edit-panel button:hover{background:#ffffff1b}.edit-stage-header span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9aa3ae}.edit-stage-content{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:12px 20px}.edit-image-frame{position:relative;flex:none;touch-action:none;cursor:crosshair}.edit-image-frame>img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}.crop-selection{position:absolute;box-sizing:border-box;border:2px solid #fff;box-shadow:0 0 0 100vmax #0009;pointer-events:none}.crop-selection:before,.crop-selection:after{content:'';position:absolute;top:0;bottom:0;width:1px;background:#ffffff55;left:33.333%}.crop-selection:after{left:66.666%}.crop-move{position:absolute;inset:0;pointer-events:auto;cursor:move}.crop-selection i{position:absolute;width:12px;height:12px;border:2px solid #fff;background:#1677c8;border-radius:2px;pointer-events:auto}.crop-nw{left:-7px;top:-7px;cursor:nwse-resize}.crop-ne{right:-7px;top:-7px;cursor:nesw-resize}.crop-sw{left:-7px;bottom:-7px;cursor:nesw-resize}.crop-se{right:-7px;bottom:-7px;cursor:nwse-resize}.result-canvas{max-width:100%;max-height:100%;object-fit:contain}.edit-stage-footer{height:48px;display:grid;place-items:center;color:#9aa3ae;font-size:12px}.edit-panel{display:flex;flex-direction:column;gap:16px;min-height:0;overflow:auto;padding:18px;border-left:1px solid #ffffff20;background:#15171a}.edit-panel-header{display:flex;align-items:center;justify-content:space-between;font-size:17px}.edit-panel-header button{width:30px;height:30px;display:grid;place-items:center;padding:0;font-size:21px}.edit-note,.edit-dimensions{margin:0;color:#9aa3ae;font-size:12px;line-height:1.5}.edit-panel section{padding:14px;border:1px solid #ffffff18;border-radius:8px;background:#ffffff07}.edit-panel h3{margin:0 0 12px;font-size:13px}.edit-panel label{display:flex;flex-direction:column;gap:7px;margin-bottom:10px}.edit-panel select,.edit-panel input[type=number]{min-width:0;width:100%;box-sizing:border-box;padding:8px;border:1px solid #ffffff30;border-radius:6px;background:#25282d;color:#fff;font:inherit}.dimension-inputs{display:grid;grid-template-columns:1fr 1fr;gap:8px}.edit-panel .stretch-option{flex-direction:row;align-items:center;gap:8px}.edit-panel button:disabled{opacity:.45;cursor:default}.edit-error{padding:8px;color:#ff9b9b;background:#7d222233;border-radius:5px}.edit-panel-actions{display:flex;gap:8px;margin-top:auto}.edit-panel-actions button{flex:1}.edit-panel button.primary{background:#1677c8;border-color:#1677c8;color:white}.edit-panel button.primary:hover{background:#2788d8}@media(max-width:720px){.image-edit-workspace{grid-template-columns:minmax(0,1fr) minmax(180px,34vw)}.edit-panel{padding:10px}.edit-stage-header{padding:0 8px;gap:6px}.edit-stage-header span{display:none}}
</style>

<style scoped>
.image-edit-workspace{background:#10151c;color:#e8edf4;}
.edit-stage{background:#0b1016;}
.edit-stage-header{height:56px;background:#1a222d;border-bottom-color:#ffffff21;}
.edit-stage-header strong{font-size:14px;font-weight:600;}
.edit-stage-header button,.edit-panel button{border-radius:var(--ui-radius-sm);transition:background-color var(--ui-motion-fast) var(--ui-ease),border-color var(--ui-motion-fast) var(--ui-ease);}
.edit-stage-header button:focus-visible,.edit-panel button:focus-visible,.edit-panel select:focus-visible,.edit-panel input:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px;}
.edit-panel{gap:14px;background:#1a222d;border-left-color:#ffffff21;}
.edit-panel-header{font-size:15px;}
.edit-panel section{border-color:#ffffff20;border-radius:var(--ui-radius);background:#ffffff08;}
.edit-panel select,.edit-panel input[type=number]{border-color:#ffffff35;border-radius:var(--ui-radius-sm);background:#26313e;}
.edit-panel-actions{position:sticky;bottom:-18px;padding:12px 0 2px;background:#1a222d;}
.edit-panel button.primary{background:var(--primary-color);border-color:var(--primary-color);color:var(--ui-on-accent);}
.edit-panel button.primary:hover{filter:brightness(1.08);}
@media(max-width:560px){.image-edit-workspace{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(180px,1fr) minmax(220px,40vh);}.edit-panel{border-left:0;border-top:1px solid #ffffff21;}.edit-panel-actions{bottom:-10px;}.edit-stage-header{height:44px;}.edit-stage-footer{height:32px;padding-inline:8px;font-size:11px;text-align:center;}}
</style>
