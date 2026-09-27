<script setup lang="ts">
import { tagLabel } from '@/features/media-library/public'
import { ref, onMounted, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import { setAppFeSetting } from '@/features/application/public'
import { useApplicationStore, type AutoTagRule as Rule } from '@/features/application/public'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons-vue'
import { t } from '@/shared/i18n/index'
import { cloneDeep } from 'lodash-es'
import { groupTags } from '@/features/media-library/public'
import { useTagStore } from '@/features/media-library/public'
import SettingsGroup from './SettingsGroup.vue'
import './settingsControls.css'

const rules = ref<Rule[]>([])
const saving = ref(false)
const globalStore = useApplicationStore()
const tagStore = useTagStore()
const readonly = computed(() => !!globalStore.conf?.is_readonly)
const dirty = computed(
  () =>
    JSON.stringify(rules.value) !==
    JSON.stringify(globalStore.conf?.app_fe_setting?.auto_tag_rules ?? [])
)
const props = defineProps<{ tagRename?: { from: string; to: string } | null }>()
watch(
  () => props.tagRename,
  (rename) => {
    if (!rename) return
    rules.value.forEach((rule) => {
      if (rule.tag === rename.from) rule.tag = rename.to
    })
  }
)

// 获取自定义标签列表
const customTags = computed(() => {
  return globalStore.conf?.all_custom_tags?.filter((tag) => tag.type === 'custom') || []
})

const tagGroups = computed(() => groupTags(customTags.value))
const filterTagOption = (input: string, option: { label?: string }) =>
  String(option?.label ?? '')
    .toLocaleLowerCase()
    .includes(input.trim().toLocaleLowerCase())

onMounted(() => {
  const savedRules = globalStore.conf?.app_fe_setting?.auto_tag_rules
  if (savedRules) {
    rules.value = cloneDeep(savedRules)
  }
})

const addRule = () => {
  rules.value.push({
    tag: '',
    filters: []
  })
}

const removeRule = (index: number) => {
  rules.value.splice(index, 1)
}

const addFilter = (rule: Rule) => {
  rule.filters.push({
    field: 'pos_prompt',
    operator: 'contains',
    value: ''
  })
}

const removeFilter = (rule: Rule, index: number) => {
  rule.filters.splice(index, 1)
}

const save = async () => {
  if (readonly.value || saving.value) return
  if (
    rules.value.some(
      (rule) =>
        !customTags.value.some((tag) => tag.name === rule.tag) ||
        !rule.filters.length ||
        rule.filters.some((filter) => !filter.value.trim())
    )
  ) {
    message.warning('请为每条规则选择标签，并填写至少一个完整条件')
    return
  }
  saving.value = true
  try {
    await setAppFeSetting('auto_tag_rules', rules.value)
    message.success(t('autoTag.saveSuccess'))
    // Update local store
    if (globalStore.conf && globalStore.conf.app_fe_setting) {
      globalStore.conf.app_fe_setting.auto_tag_rules = cloneDeep(rules.value)
    }
  } catch (e) {
    message.error(t('autoTag.saveFail') + ': ' + e)
  } finally {
    saving.value = false
  }
}

const fieldOptions = computed(() => [
  { label: t('autoTag.fields.posPrompt'), value: 'pos_prompt' },
  { label: t('autoTag.fields.negPrompt'), value: 'neg_prompt' },
  { label: t('autoTag.fields.model'), value: 'Model' },
  { label: t('autoTag.fields.lora'), value: 'lora' },
  { label: t('autoTag.fields.sampler'), value: 'Sampler' },
  { label: t('autoTag.fields.source'), value: 'Source Identifier' },
  { label: t('autoTag.fields.size'), value: 'Size' },
  { label: t('autoTag.fields.cfgScale'), value: 'CFG scale' },
  { label: t('autoTag.fields.steps'), value: 'Steps' },
  { label: t('autoTag.fields.seed'), value: 'Seed' }
])

const operatorOptions = computed(() => [
  { label: t('autoTag.operators.contains'), value: 'contains' },
  { label: t('autoTag.operators.equals'), value: 'equals' },
  { label: t('autoTag.operators.regex'), value: 'regex' }
])
</script>

<template>
  <SettingsGroup
    class="auto-tag-settings"
    title="自动打标规则"
    help="扫描或重建索引时，全部条件满足才会添加标签。已有媒体需要重新应用规则时，请重建索引。"
  >
    <template #actions>
      <a-button :disabled="readonly || saving" @click="addRule"
        ><template #icon><PlusOutlined /></template>{{ t('autoTag.addRule') }}</a-button
      >
    </template>
    <div class="rules-list">
      <div v-for="(rule, rIndex) in rules" :key="rIndex" class="rule-card">
        <div class="rule-header">
          <span class="rule-number">{{ rIndex + 1 }}</span>
          <span class="rule-label">添加标签</span>
          <a-select
            class="rule-field"
            v-model:value="rule.tag"
            :disabled="readonly || saving || !customTags.length"
            :aria-label="`规则 ${rIndex + 1} 的标签`"
            :placeholder="t('autoTag.inputTagName')"
            show-search
            :filter-option="filterTagOption"
            :list-height="280"
            option-label-prop="label"
          >
            <a-select-opt-group v-for="group in tagGroups" :key="group.key" :label="group.label">
              <a-select-option
                v-for="tag in group.tags"
                :key="tag.id"
                :value="tag.name"
                :label="tagLabel(tag)"
              >
                <span class="tag-option-label"
                  ><span class="tag-dot" :style="{ background: tagStore.getColor(tag) }" />{{
                    tagLabel(tag)
                  }}</span
                >
              </a-select-option>
            </a-select-opt-group>
          </a-select>
          <a-button
            type="text"
            danger
            :disabled="readonly || saving"
            :aria-label="`删除规则 ${rIndex + 1}`"
            @click="removeRule(rIndex)"
          >
            <template #icon><DeleteOutlined /></template>
          </a-button>
        </div>

        <div class="filters-list">
          <div v-for="(filter, fIndex) in rule.filters" :key="fIndex" class="filter-row">
            <a-select
              v-model:value="filter.field"
              class="rule-field"
              :disabled="readonly || saving"
              :aria-label="`规则 ${rIndex + 1} 条件 ${fIndex + 1} 字段`"
              :options="fieldOptions"
            />
            <a-select
              v-model:value="filter.operator"
              class="rule-operator"
              :disabled="readonly || saving"
              :aria-label="`规则 ${rIndex + 1} 条件 ${fIndex + 1} 运算符`"
              :options="operatorOptions"
            />
            <a-input
              v-model:value="filter.value"
              :placeholder="t('autoTag.value')"
              class="rule-value"
              :disabled="readonly || saving"
              :aria-label="`规则 ${rIndex + 1} 条件 ${fIndex + 1} 匹配内容`"
            />
            <a-button
              type="text"
              danger
              :disabled="readonly || saving"
              :aria-label="`删除规则 ${rIndex + 1} 条件 ${fIndex + 1}`"
              @click="removeFilter(rule, fIndex)"
            >
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </div>
          <a-button
            class="add-condition"
            type="link"
            :disabled="readonly || saving"
            @click="addFilter(rule)"
          >
            <template #icon><PlusOutlined /></template>
            {{ t('autoTag.addFilter') }}
          </a-button>
        </div>
      </div>
    </div>
    <div v-if="rules.length === 0" class="empty-tip">暂无规则</div>
    <div class="rule-save">
      <span>{{ dirty ? '有未保存更改' : rules.length ? '所有条件均满足时打标' : '' }}</span>
      <a-button type="primary" :disabled="readonly || !dirty" :loading="saving" @click="save">{{
        t('autoTag.saveConfig')
      }}</a-button>
    </div>
  </SettingsGroup>
</template>

<style scoped>
.auto-tag-settings {
  min-width: 0;
  container-type: inline-size;
}
.rules-list {
  display: grid;
  gap: 12px;
  padding-top: 16px;
}
.rule-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
}
.rule-header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 12px;
}
.rule-number {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--ui-surface-soft);
  color: var(--zp-secondary);
  font-size: 12px;
  flex: none;
}
.rule-label {
  font-size: 12px;
  color: var(--zp-secondary);
  flex: none;
}
.rule-header .rule-field {
  flex: 1;
  min-width: 0;
  max-width: 280px;
}
.rule-header > .ant-btn {
  margin-left: auto;
}
.filters-list {
  display: grid;
  gap: 8px;
}
.filter-row {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) minmax(90px, 0.7fr) minmax(100px, 1.4fr) 32px;
  gap: 8px;
}
.filter-row > * {
  width: 100%;
  min-width: 0;
}
.add-condition {
  justify-self: start;
  padding-left: 0;
}
.tag-option-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.tag-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
}
.rule-save {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 0;
}
.rule-save > span {
  font-size: 12px;
  color: var(--zp-secondary);
}
.empty-tip {
  text-align: center;
  font-size: 13px;
  color: var(--zp-secondary);
  padding: 24px 0;
}
@container (max-width: 520px) {
  .filter-row {
    grid-template-columns: minmax(0, 1fr) 32px;
  }
  .rule-field,
  .rule-operator,
  .rule-value {
    grid-column: 1;
  }
  .filter-row > .ant-btn {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
