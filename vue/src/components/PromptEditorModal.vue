<script setup lang="ts">
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import { t } from '@/i18n'
import { updateExif, getImageGenerationInfo } from '@/api'
import { parse } from '@/util/stable-diffusion-image-metadata'
import { globalEvents, useGlobalEventListen } from '@/util'
import type { FileNodeInfo } from '@/api/files'
import KvPairEditor from './KvPairEditor.vue'

interface KVPair {
  key: string
  value: any
}

// 组件内部状态
const show = ref(false)
const file = ref<FileNodeInfo | null>(null)
const currentPrompt = ref<string>('')

// 监听全局事件
useGlobalEventListen('openPromptEditor', async (data: { file: FileNodeInfo }) => {
  file.value = data.file
  console.log('Received openPromptEditor event for file:', data.file)
  // 每次打开时都获取最新的提示词数据
  try {
    const latestPrompt = await getImageGenerationInfo(data.file.fullpath)
    currentPrompt.value = latestPrompt
  } catch (error) {
    console.error('Failed to fetch latest prompt:', error)
    currentPrompt.value = ''
  }

  initializeData()
  show.value = true
})

// 基础元数据字段（当为空时使用）
const defaultMetadata = 'Steps: 20'

// 计算字段（从其他字段派生，不可编辑）
const computedFields = ['hashes', 'resources']

// 解析当前提示词
const parsePrompt = (promptStr: string) => {
  const parsed = parse(promptStr)
  // 解析普通参数（排除计算字段和 extraJsonMetaInfo）
  const otherInfo = Object.entries(parsed)
    .filter(([key]) =>
      key !== 'prompt' &&
      key !== 'negativePrompt' &&
      !computedFields.includes(key) &&
      key !== 'extraJsonMetaInfo'
    )
    .map(([key, value]) => `${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`)
    .join('\n')

  // 解析 extraJsonMetaInfo 为 KV 对
  const extraJsonMetaInfo = parsed.extraJsonMetaInfo as Record<string, any> | undefined
  const kvPairs: KVPair[] = []
  if (extraJsonMetaInfo) {
    Object.entries(extraJsonMetaInfo).forEach(([key, value]) => {
      // 根据值的类型决定模式：字符串用字符串模式，其他用JSON模式
      kvPairs.push({
        key,
        value
      })
    })
  }

  return {
    prompt: parsed.prompt || '',
    negativePrompt: parsed.negativePrompt || '',
    otherInfo: otherInfo || defaultMetadata,
    kvPairs
  }
}

// 构建完整提示词
const buildPrompt = (positive: string, negative: string, other: string, kvPairs: KVPair[]) => {
  let result = ''
  if (positive) result += positive
  result += `\nNegative prompt: ${negative || ''}`

  // 添加普通参数
  if (other) {
    result += `\n${other.split('\n').filter(line => line.trim()).join(', ')}`
  } else {
    result += `\n${defaultMetadata}`
  }

  // 添加 extraJsonMetaInfo
  if (kvPairs.length > 0) {
    const extraMeta: Record<string, any> = Object.fromEntries(kvPairs.map(kv => [kv.key.trim(), kv.value]))
    result += `\nextraJsonMetaInfo: ${JSON.stringify(extraMeta)}`
  }

  return result.trim()
}

// 初始化数据
const positivePrompt = ref('')
const negativePrompt = ref('')
const otherInfo = ref(defaultMetadata)
const kvPairs = ref<KVPair[]>([])
const saving = ref(false)
const kvEditorRefs = ref<any[]>([])

// 当文件或提示词变化时重新初始化
const initializeData = () => {
  const data = currentPrompt.value ? parsePrompt(currentPrompt.value) : {
    prompt: '',
    negativePrompt: '',
    otherInfo: defaultMetadata,
    kvPairs: []
  }
  positivePrompt.value = data.prompt
  negativePrompt.value = data.negativePrompt
  otherInfo.value = data.otherInfo
  kvPairs.value = data.kvPairs
}

// 添加新的 KV 对
const addKvPair = () => {
  kvPairs.value.push({ key: '', value: '' })
}

// 删除 KV 对
const removeKvPair = (index: number) => {
  kvPairs.value.splice(index, 1)
  kvEditorRefs.value.splice(index, 1)
}

// 保存
const handleSave = async () => {
  if (!file.value) return

  // 校验正向提示词不可为空
  if (!positivePrompt.value.trim()) {
    message.error(t('positivePromptRequired'))
    return
  }

  // 校验所有 KV 编辑器
  const validators = kvEditorRefs.value
    .filter(ref => ref && ref.validate)
    .map(ref => ref.validate())

  if (validators.some(valid => !valid)) {
    message.error(t('fixErrorsBeforeSave'))
    return
  }

  saving.value = true
  try {

    const fullPrompt = buildPrompt(positivePrompt.value, negativePrompt.value, otherInfo.value, kvPairs.value)
    await updateExif(file.value.fullpath, fullPrompt)
    message.success(t('savePromptSuccess'))

    // 关闭模态框并触发全局事件
    show.value = false
    globalEvents.emit('promptEditorUpdated')
  } catch (error: any) {
    console.error('Save prompt error:', error)
    if (error.message && !error.message.includes('Invalid JSON')) {
      message.error(t('savePromptFailed'))
    }
    throw error
  } finally {
    saving.value = false
  }
}

// 取消
const handleCancel = () => {
  show.value = false
}
</script>

<template>
  <a-modal v-model:open="show" :title="file ? t('editPromptTitle', { name: file.name }) : ''" :width="900"
    :maskClosable="true" destroyOnClose  >
    <div class="prompt-editor-modal" @wheel.stop @keydown.stop @keyup.stop @keypress.stop>
      <div class="editor-section">
        <div class="section-label">{{ t('positivePrompt') }}</div>
        <a-textarea v-model:value="positivePrompt" :placeholder="t('positivePrompt')"
          :autoSize="{ minRows: 3, maxRows: 8 }" class="prompt-input" />
      </div>

      <div class="editor-section">
        <div class="section-label">{{ t('negativePrompt') }}</div>
        <a-textarea v-model:value="negativePrompt" :placeholder="t('negativePrompt')"
          :autoSize="{ minRows: 2, maxRows: 6 }" class="prompt-input" />
      </div>

      <div class="editor-section">
        <div class="section-label">
          {{ t('otherInfo') }}
          <span class="section-hint">({{ t('otherInfoHint') }})</span>
        </div>
        <a-textarea v-model:value="otherInfo" :placeholder="t('otherInfo')" :autoSize="{ minRows: 2, maxRows: 6 }"
          class="prompt-input" />
      </div>

      <div class="editor-section kv-editor-section">
        <div class="kv-header">
          <div class="section-label">{{ t('extraMetaInfoTitle') }}</div>
          <a-button size="small" @click="addKvPair">{{ t('addKvButton') }}</a-button>
        </div>
        <div class="section-hint">
          {{ t('extraMetaInfoHint') }}
        </div>

        <div v-if="kvPairs.length === 0" class="empty-state">
          {{ t('noExtraMetaInfo') }}
        </div>

        <div v-else class="kv-list">
          <KvPairEditor
            v-for="(_, index) in kvPairs"
            :key="index"
            :ref="(el: any) => { if (el) kvEditorRefs[index] = el }"
            v-model="kvPairs[index]"
            :allKeys="kvPairs.filter((_, i) => i !== index).map(kv => kv.key)"
            @remove="removeKvPair(index)"
          />
        </div>
      </div>

    </div>
    <template #footer>
      <a-button @click="handleCancel">{{ t('cancel') }}</a-button>
      <a-button type="primary" @click="handleSave" :loading="saving">{{ t('savePrompt') }}</a-button>
    </template>
  </a-modal>
</template>

<style scoped lang="scss">
.prompt-editor-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: min(65dvh, calc(100dvh - 240px));
  padding-right: 8px;
  overflow-y: auto;
}

.editor-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-label {
  font-size: 12px;
  color: var(--zp-primary);
  font-weight: 500;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.section-hint {
  font-size: 11px;
  color: var(--zp-secondary);
  font-weight: 400;
}

.prompt-input {
  font-size: 13px;
}

.kv-editor-section {
  border: 1px solid var(--zp-secondary-variant-background);
  border-radius: 4px;
  padding: 12px;
  background: var(--zp-secondary-background);
}

.kv-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 8px;
}

.kv-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  text-align: center;
  padding: 20px;
  color: var(--zp-secondary);
  font-size: 12px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--zp-secondary-variant-background);
}
</style>
