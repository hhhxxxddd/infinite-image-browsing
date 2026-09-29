<script setup lang="ts">
import { levelDb, levelLabel, type StereoLevel } from '../model/audioLevels'
defineProps<{ levels: StereoLevel; peak: number; overloaded: boolean; playing: boolean }>()
defineEmits<{ reset: [] }>()
const width = (value: number) =>
  `${Math.max(0, Math.min(100, ((levelDb(value) + 60) / 60) * 100))}%`
</script>
<template>
  <div class="mix-meter" :class="{ overloaded }" role="region" aria-label="混音音量表">
    <div class="meter-heading">
      <strong>混音音量</strong><span>{{ playing ? '试听中' : '已停止' }}</span>
      <button type="button" @click="$emit('reset')" aria-label="重置音量峰值">重置峰值</button>
    </div>
    <div v-for="(value, index) in levels" :key="index" class="meter-channel">
      <span>{{ index ? 'R' : 'L' }}</span>
      <div
        class="meter-bar"
        role="meter"
        :aria-label="index ? '右声道电平' : '左声道电平'"
        aria-valuemin="-60"
        aria-valuemax="0"
        :aria-valuenow="Math.max(-60, Math.min(0, levelDb(value)))"
        :aria-valuetext="levelLabel(levelDb(value))"
      >
        <i :style="{ width: width(value) }" />
      </div>
      <output>{{ levelLabel(levelDb(value)) }}</output>
    </div>
    <div class="meter-footer">
      <span>峰值 {{ levelLabel(levelDb(peak)) }}</span>
      <strong v-if="overloaded" role="status">过载 · 请降低片段、音轨或总音量</strong>
      <span v-else>0 dBFS 为上限</span>
    </div>
  </div>
</template>
<style scoped>
.mix-meter {
  padding: 10px 12px;
  border: 1px solid #ffffff1f;
  border-radius: 9px;
  background: #171e26;
  font-size: 11px;
}
.meter-heading,
.meter-channel,
.meter-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.meter-heading {
  margin-bottom: 8px;
}
.meter-heading > span {
  color: #94a3b6;
}
.meter-heading button {
  margin-left: auto;
  padding: 2px 6px;
  font-size: 11px;
}
.meter-heading button {
  border: 1px solid #ffffff25;
  border-radius: 5px;
  color: #b8cce8;
  background: #ffffff08;
  cursor: pointer;
}
.meter-channel {
  margin-top: 4px;
}
.meter-channel > span {
  width: 10px;
  color: #9fb0c4;
}
.meter-channel output {
  width: 78px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.meter-bar {
  flex: 1;
  height: 7px;
  background: #0b1016;
  border-radius: 2px;
  overflow: clip;
}
.meter-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(
    90deg,
    #53ba9e 0%,
    #53ba9e 75%,
    #e4b45b 75%,
    #e4b45b 94%,
    #e26060 94%
  );
  transition: width 70ms linear;
}
.meter-footer {
  flex-wrap: wrap;
  justify-content: space-between;
  color: #94a3b6;
  margin-top: 8px;
}
.meter-footer strong {
  color: #ff9292;
  font-weight: 500;
}
.overloaded {
  border-color: #e46e6e88;
}
@media (prefers-reduced-motion: reduce) {
  .meter-bar i {
    transition: none;
  }
}
</style>
