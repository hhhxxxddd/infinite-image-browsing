<script setup lang="ts">
import DesktopAIRuntime from './DesktopAIRuntime.vue'
import DesktopMediaRuntime from './DesktopMediaRuntime.vue'

defineProps<{ active: boolean }>()
</script>

<template>
  <div class="settings-stack">
    <DesktopMediaRuntime :active="active" />
    <DesktopAIRuntime :active="active" />
  </div>
</template>
