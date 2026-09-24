<script setup lang="ts">
import { ref, watch } from 'vue'
import { CustomerServiceOutlined } from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/api/files'
import { audioCoverUrl, getAudioMetadata, type AudioMetadata } from '@/api/audio'

const props = defineProps<{ file: FileNodeInfo }>()
const details = ref<AudioMetadata>()
const artworkAvailable = ref(false)
watch(() => [props.file.fullpath, props.file.date], async ([path], _, onCleanup) => {
  let canceled = false
  onCleanup(() => { canceled = true })
  details.value = undefined
  artworkAvailable.value = false
  try {
    const result = await getAudioMetadata(path)
    if (!canceled) { details.value = result; artworkAvailable.value = result.has_cover }
  } catch { /* The filename remains usable if metadata is missing. */ }
}, { immediate: true })
</script>

<template>
  <div class="audio-artwork">
    <img v-if="artworkAvailable" :src="audioCoverUrl(file)" :alt="`${details?.album || details?.title || file.name} 的封面`" loading="lazy" decoding="async" @error="artworkAvailable = false" />
    <div v-else class="audio-fallback"><CustomerServiceOutlined /></div>
    <span class="audio-kind" aria-label="音频"><CustomerServiceOutlined /></span>
    <div class="audio-track-info">
      <strong :title="details?.title || file.name">{{ details?.title || file.name.replace(/\.[^.]+$/, '') }}</strong>
      <span v-if="details?.artist" :title="details.artist">{{ details.artist }}</span>
    </div>
  </div>
</template>

<style scoped>
.audio-artwork{position:relative;width:100%;height:100%;overflow:hidden;background:linear-gradient(145deg,#142a43,#314763);color:white}
.audio-artwork img{display:block;width:100%;height:100%;object-fit:contain}
.audio-fallback{display:grid;place-items:center;width:100%;height:100%;font-size:clamp(38px,7vw,72px);color:#bcd8f4}
.audio-kind{position:absolute;top:9px;right:9px;display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:#071421c9;color:#fff;font-size:15px}
.audio-track-info{position:absolute;right:0;bottom:0;left:0;display:flex;flex-direction:column;gap:2px;min-height:58px;padding:20px 11px 10px;background:linear-gradient(transparent,#071421e8);font-size:11px;line-height:1.3}
.audio-track-info strong,.audio-track-info span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.audio-track-info strong{font-size:13px}
.audio-track-info span{color:#d4e3f1}
</style>
