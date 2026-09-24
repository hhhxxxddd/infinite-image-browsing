<script setup lang="ts">
import { ref, watch } from 'vue'
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
    <div v-else class="audio-fallback" aria-hidden="true"></div>
    <div class="audio-track-info">
      <strong :title="details?.title || file.name">{{ details?.title || file.name.replace(/\.[^.]+$/, '') }}</strong>
      <span v-if="details?.artist" :title="details.artist">{{ details.artist }}</span>
    </div>
  </div>
</template>

<style scoped>
.audio-artwork{position:relative;width:100%;height:100%;overflow:hidden;background:#354653;color:white}
.audio-artwork img{display:block;width:100%;height:100%;object-fit:contain}
.audio-fallback{width:100%;height:100%;background:#354653}
.audio-track-info{position:absolute;right:0;bottom:0;left:0;display:flex;flex-direction:column;gap:2px;min-height:58px;padding:20px 11px 10px;background:linear-gradient(transparent,#111924e8);font-size:11px;line-height:1.3}
.audio-track-info strong,.audio-track-info span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.audio-track-info strong{font-size:13px}
.audio-track-info span{color:#e4edf6}
</style>
