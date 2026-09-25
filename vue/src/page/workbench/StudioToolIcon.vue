<script setup lang="ts">
defineProps<{ kind: 'brush' | 'eraser' | 'mask' | 'arrow' | 'marker' | 'hand' | 'crop' }>()
</script>

<template>
  <svg v-if="kind === 'hand'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M7 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-1V6a1.5 1.5 0 0 1 3 0v6" />
    <path d="M16 11a1.5 1.5 0 0 1 3 0v5c0 3-2.4 5-5.5 5h-3c-2 0-3.2-.8-4.3-2.2l-3.4-4.5a1.5 1.5 0 0 1 2.2-2L7 14" />
  </svg>
  <svg v-else-if="kind === 'brush' || kind === 'mask'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <rect x="2.5" y="6" width="16" height="15" rx="2" />
    <circle cx="10.5" cy="13.5" r="4" fill="currentColor" stroke="none" opacity=".35" />
    <path d="M19 2v7m-3.5-3.5h7" />
  </svg>
  <svg v-else-if="kind === 'arrow'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M4 20 20 4M11 4h9v9" />
  </svg>
  <svg v-else-if="kind === 'crop'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M5 2v15a2 2 0 0 0 2 2h15M2 5h15a2 2 0 0 1 2 2v15" />
  </svg>
  <svg v-else-if="kind === 'marker'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="m5 16 10-10 3 3L8 19H5zM13 8l3 3M3 22h18" />
    <path d="M7 19h10" stroke-width="3" />
  </svg>
  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="m8.5 4.7 10.8 10.8a2 2 0 0 1 0 2.8L16.6 21H9.2L3.7 15.5a2 2 0 0 1 0-2.8l5.1-5.2a2 2 0 0 1 2.8 0" />
    <path d="m6.5 18.3 7-7M16.6 21H21" />
  </svg>
</template>

<style scoped>
svg { display: block; width: 18px; height: 18px; flex: none; }
</style>
