<script setup lang="ts">
import { tagLabel } from '@/util/tagLabel'
import { ref, onMounted, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import { setAppFeSetting } from '@/api'
import { useGlobalStore } from '@/store/useGlobalStore'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons-vue'
import { t } from '@/i18n'
import { cloneDeep } from 'lodash-es'
import { groupTags } from '@/util/tagGroups'
import { useTagStore } from '@/store/useTagStore'

interface Filter {
  field: string
  operator: string
  value: string
}

interface Rule {
  tag: string
  filters: Filter[]
}

const rules = ref<Rule[]>([])
const globalStore = useGlobalStore()
const tagStore = useTagStore()
const props = defineProps<{ tagRename?: { from: string; to: string } | null }>()
watch(() => props.tagRename, rename => {
  if (!rename) return
  rules.value.forEach(rule => {
    if (rule.tag === rename.from) rule.tag = rename.to
  })
})

// 获取自定义标签列表
const customTags = computed(() => {
  return globalStore.conf?.all_custom_tags?.filter(tag => tag.type === 'custom') || []
})

const tagGroups = computed(() => groupTags(customTags.value))
const filterTagOption = (input: string, option: { label?: string }) =>
  String(option?.label ?? '').toLocaleLowerCase().includes(input.trim().toLocaleLowerCase())

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
  if (globalStore.conf?.is_readonly) return
  if (rules.value.some(rule => !customTags.value.some(tag => tag.name === rule.tag) ||
      !rule.filters.length || rule.filters.some(filter => !filter.value.trim()))) {
    message.warning('请为每条规则选择标签，并填写至少一个完整条件')
    return
  }
  try {
    await setAppFeSetting('auto_tag_rules' as any, rules.value)
    message.success(t('autoTag.saveSuccess'))
    // Update local store
    if (globalStore.conf && globalStore.conf.app_fe_setting) {
      globalStore.conf.app_fe_setting.auto_tag_rules = cloneDeep(rules.value)
    }
  } catch (e) {
    message.error(t('autoTag.saveFail') + ': ' + e)
  }
}

const fieldOptions = computed(() => [
  { label: t('autoTag.fields.posPrompt'), value: 'pos_prompt' },
  { label: t('autoTag.fields.negPrompt'), value: 'neg_prompt' },
  { label: t('autoTag.fields.model'), value: 'Model' },
  { label: t('autoTag.fields.lora'), value: 'lora' },
  { label: t('autoTag.fields.sampler'), value: 'Sampler' },
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
  <div class="auto-tag-settings">
    <div class="header">
      <div class="description">增量扫描或重建索引解析图片时，会按这些规则自动添加标签。同一规则的所有条件都满足时才会打标；已有图片需要重新应用规则时，可手动重建索引。</div>
      <div class="actions">
        <a-button type="primary" @click="addRule">
          <template #icon><PlusOutlined /></template>
          {{ t('autoTag.addRule') }}
        </a-button>
        <a-button type="primary" @click="save" >{{ t('autoTag.saveConfig') }}</a-button>
      </div>
    </div>

    <div class="rules-list">
      <div v-for="(rule, rIndex) in rules" :key="rIndex" class="rule-card">
        <div class="rule-header">
          <a-select
            class="rule-field"
            v-model:value="rule.tag"
            :disabled="!customTags.length"
            :placeholder="t('autoTag.inputTagName')"
            show-search
            :filter-option="filterTagOption"
            :list-height="280"
            option-label-prop="label"
          >
            <a-select-opt-group v-for="group in tagGroups" :key="group.key" :label="group.label">
              <a-select-option v-for="tag in group.tags" :key="tag.id" :value="tag.name" :label="tagLabel(tag)">
                <span class="tag-option-label"><span class="tag-dot" :style="{ background: tagStore.getColor(tag) }" />{{ tagLabel(tag) }}</span>
              </a-select-option>
            </a-select-opt-group>
          </a-select>
          <a-button type="text" danger @click="removeRule(rIndex)">
            <template #icon><DeleteOutlined /></template>
          </a-button>
        </div>

        <div class="filters-list">
          <div v-for="(filter, fIndex) in rule.filters" :key="fIndex" class="filter-row">
            <a-select v-model:value="filter.field" class="rule-field" :options="fieldOptions" />
            <a-select v-model:value="filter.operator" class="rule-operator" :options="operatorOptions" />
            <a-input v-model:value="filter.value" :placeholder="t('autoTag.value')" class="rule-value" />
            <a-button type="text" danger @click="removeFilter(rule, fIndex)">
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </div>
          <a-button type="dashed" block @click="addFilter(rule)" style="margin-top: 8px">
            <template #icon><PlusOutlined /></template>
            {{ t('autoTag.addFilter') }}
          </a-button>
        </div>
      </div>
    </div>
    <div v-if="rules.length === 0" class="empty-tip">
      {{ t('autoTag.noRules') }}
    </div>
  </div>
</template>

<style scoped lang="scss">
.auto-tag-settings {
  padding: 16px;
}

.header {
  margin-bottom: 16px;

  .description {
    padding: 12px 16px;
    margin-bottom: 12px;
    background: var(--zp-secondary-background);
    border-left: 4px solid var(--primary-color);
    border-radius: 4px;
    color: var(--zp-secondary-text);
    font-size: 14px;
  }

  .actions {
    display: flex;
  }
}

.rules-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.rule-card {
  border: 1px solid var(--zp-border);
  border-radius: 8px;
  padding: 16px;
  background: var(--zp-secondary-background);
}

.rule-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--zp-border);
}

.filters-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.empty-tip {
  text-align: center;
  color: var(--zp-secondary-text);
  padding: 32px;
}


.auto-tag-settings{padding:0;min-width:0;container-type:inline-size;}
.header .actions{gap:8px;flex-wrap:wrap;}.header .description{line-height:1.7;color:var(--zp-secondary);}
.rule-header{gap:8px;}.rule-header .rule-field{width:100%;min-width:0;max-width:320px;}
.tag-option-label{display:inline-flex;align-items:center;gap:8px;}
.tag-dot{width:9px;height:9px;border-radius:50%;flex:none;}
.filter-row{display:grid;grid-template-columns:minmax(100px,1fr) minmax(90px,.7fr) minmax(100px,1fr) 32px;align-items:start;}
.filter-row > *{width:100%;min-width:0;}.rule-card{min-width:0;}.empty-tip{color:var(--zp-secondary);}
@container(max-width:520px){.filter-row{grid-template-columns:minmax(0,1fr) 32px;gap:8px;}.rule-field,.rule-operator,.rule-value{grid-column:1;}.filter-row>.ant-btn{grid-column:2;grid-row:1;}.rule-card{padding:12px;}}

</style>
