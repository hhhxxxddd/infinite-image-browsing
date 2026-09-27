<script setup lang="ts">
import SettingsHelp from './SettingsHelp.vue'
defineProps<{ label: string; help?: string; compact?: boolean }>()
</script>

<template>
  <div class="settings-row" :class="{ compact }">
    <div class="settings-row-label">
      <span>{{ label }}</span>
      <SettingsHelp v-if="help || $slots.help" :label="label"
        ><slot name="help">{{ help }}</slot></SettingsHelp
      >
    </div>
    <div class="settings-row-content"><slot /></div>
  </div>
</template>

<style scoped>
.settings-row {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  padding: 20px 0;
}
.settings-row + .settings-row {
  border-top: 1px solid var(--ui-border);
}
.settings-row-label {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 32px;
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 500;
}
.settings-row-content {
  min-width: 0;
}
.settings-row.compact {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  padding: 12px 0;
}
.compact .settings-row-content {
  display: flex;
  justify-content: flex-end;
}
@container (max-width: 650px) {
  .settings-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
}
</style>
