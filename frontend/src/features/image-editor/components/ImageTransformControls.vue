<script setup lang="ts">
import { transformRatios, maxTransformDimension, type TransformSize } from '../model/imageTransform'
defineProps<{
  ratio: string
  output: TransformSize
  locked: boolean
  readonly?: boolean
  applyDisabled?: boolean
}>()
defineEmits<{
  ratio: [value: string]
  reset: []
  lock: [value: boolean]
  size: [axis: 'width' | 'height', value: number]
  apply: []
  cancel: []
}>()
</script>

<template>
  <div class="transform-settings">
    <div class="transform-scroll">
      <section>
        <div class="transform-heading">
          <strong>画面比例</strong
          ><button type="button" :disabled="readonly" @click="$emit('reset')">重置</button>
        </div>
        <div class="transform-ratios">
          <button
            v-for="value in transformRatios"
            :key="value"
            type="button"
            :disabled="readonly"
            :class="{ active: ratio === value }"
            :aria-pressed="ratio === value"
            @click="$emit('ratio', value)"
          >
            <i
              :style="{
                aspectRatio:
                  value === 'free' || value === 'original' ? '1.4' : value.replace(':', '/')
              }"
              :class="{ free: value === 'free' }"
            />
            {{ value === 'free' ? '自由' : value === 'original' ? '原比例' : value }}
          </button>
        </div>
      </section>
      <section>
        <div class="transform-heading">
          <strong>输出尺寸</strong
          ><label class="transform-aspect"
            >保持比例<a-switch
              :checked="locked"
              size="small"
              :disabled="readonly"
              @change="$emit('lock', !!$event)"
          /></label>
        </div>
        <div class="transform-dimensions">
          <label v-for="axis in ['width', 'height'] as const" :key="axis"
            >{{ axis === 'width' ? '宽度' : '高度' }}
            <span
              ><button
                type="button"
                :disabled="readonly || output[axis] <= 1"
                :aria-label="axis === 'width' ? '减小宽度' : '减小高度'"
                @click="$emit('size', axis, output[axis] - 1)"
              >
                −
              </button>
              <input
                type="number"
                min="1"
                :max="maxTransformDimension"
                :disabled="readonly"
                :aria-label="axis === 'width' ? '输出宽度' : '输出高度'"
                :value="output[axis]"
                @input="
                  ($event.target as HTMLInputElement).value &&
                  $emit('size', axis, Number(($event.target as HTMLInputElement).value))
                "
              />
              <button
                type="button"
                :disabled="readonly || output[axis] >= maxTransformDimension"
                :aria-label="axis === 'width' ? '增大宽度' : '增大高度'"
                @click="$emit('size', axis, output[axis] + 1)"
              >
                ＋
              </button>
            </span>
          </label>
        </div>
      </section>
      <section v-if="$slots.default"><slot /></section>
    </div>
    <div class="transform-actions" role="group" aria-label="应用图片调整">
      <button type="button" @click="$emit('cancel')">取消</button
      ><button
        type="button"
        class="primary"
        :disabled="readonly || applyDisabled"
        @click="$emit('apply')"
      >
        应用调整
      </button>
    </div>
  </div>
</template>

<style scoped>
.transform-settings {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  color: var(--ui-text);
  font-size: var(--editor-field-font-size, 12px);
}
.transform-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
}
section + section {
  border-top: 1px solid var(--ui-border);
  padding-top: var(--editor-panel-spacing, 12px);
  margin-top: var(--editor-panel-spacing, 12px);
}
.transform-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.transform-heading > button {
  border: 0;
  background: none;
  color: var(--ui-muted);
  font: inherit;
  cursor: pointer;
  padding: 0;
}
.transform-aspect {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--ui-muted);
}
.transform-ratios {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.transform-ratios button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  height: 40px;
  padding: 3px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}
.transform-ratios button.active {
  background: var(--primary-color-1);
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.transform-ratios i {
  display: block;
  height: 12px;
  max-width: 25px;
  border: 1px solid currentColor;
  border-radius: 2px;
}
.transform-ratios i.free {
  border-style: dashed;
}
.transform-dimensions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--editor-panel-spacing, 12px);
}
.transform-dimensions label {
  min-width: 0;
  color: var(--ui-muted);
  font-size: inherit;
}
.transform-dimensions label > span {
  display: flex;
  align-items: center;
  border: 1px solid var(--ui-control-border);
  background: var(--ui-surface-soft);
  border-radius: 8px;
  height: var(--editor-field-height, 32px);
  margin-top: 6px;
  overflow: hidden;
}
.transform-dimensions input {
  width: 0;
  min-width: 0;
  flex: 1;
  text-align: center;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--ui-text);
  outline: none;
  font: inherit;
  appearance: textfield;
}
.transform-dimensions input::-webkit-inner-spin-button {
  appearance: none;
}
.transform-dimensions button {
  width: 26px;
  flex: none;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
  padding: 0;
}
.transform-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border);
}
.transform-actions button {
  flex: 1;
  height: var(--editor-field-height, 32px);
  border: 1px solid var(--ui-control-border);
  border-radius: 8px;
  color: var(--ui-muted);
  background: transparent;
  cursor: pointer;
  font: inherit;
}
.transform-actions button.primary {
  background: var(--primary-color);
  color: #142338;
  border-color: var(--primary-color);
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
</style>
