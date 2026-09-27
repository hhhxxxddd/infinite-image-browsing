<script setup lang="ts">
import SettingsHelp from './SettingsHelp.vue'
defineProps<{ title: string; help?: string }>()
</script>

<template>
  <section class="settings-group" :aria-label="title">
    <header class="settings-group-heading">
      <h2>{{ title }}</h2>
      <SettingsHelp v-if="help" :label="title">{{ help }}</SettingsHelp>
      <slot name="extra" />
      <div v-if="$slots.actions" class="settings-group-actions"><slot name="actions" /></div>
    </header>
    <div class="settings-group-body"><slot /></div>
  </section>
</template>

<style scoped>
.settings-group {
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
}
.settings-group-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 48px;
  padding: 0 20px;
  border-bottom: 1px solid var(--ui-border);
}
.settings-group-heading h2 {
  margin: 0;
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 650;
}
.settings-group-body {
  padding: 0 20px;
}
.settings-group-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
@container (max-width: 650px) {
  .settings-group-heading {
    padding: 0 16px;
  }
  .settings-group-body {
    padding: 0 16px;
  }
}
</style>
