<script setup lang="ts">
import { ref, watch } from 'vue'
import type { FileNodeInfo } from '@/features/media-library/api/files'
import { audioCoverUrl, getAudioMetadata } from '@/features/media-library/api/audio'

const props = defineProps<{ file: FileNodeInfo }>()
const artworkAvailable = ref(false)
watch(
  () => [props.file.fullpath, props.file.date],
  async ([path], _, onCleanup) => {
    let canceled = false
    onCleanup(() => {
      canceled = true
    })
    artworkAvailable.value = false
    try {
      const result = await getAudioMetadata(path)
      if (!canceled) {
        artworkAvailable.value = result.has_cover
      }
    } catch {
      /* Keep the fallback artwork if metadata is missing. */
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="audio-artwork">
    <img
      v-if="artworkAvailable"
      :src="audioCoverUrl(file)"
      :alt="`${file.name} 的封面`"
      loading="lazy"
      decoding="async"
      @error="artworkAvailable = false"
    />
    <div v-else class="audio-fallback" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
.audio-artwork {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #354653;
  color: white;
}
.audio-artwork img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.audio-fallback {
  width: 100%;
  height: 100%;
  background: #354653;
}
</style>
