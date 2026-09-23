<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { getQwenModels, getQwenStatus, installQwenModel, saveQwenConfig, selectQwenModel, startQwenIndex, type QwenModelKind, type QwenModelManager, type QwenModelSize, type QwenStatus } from '@/api/qwen3vl'
import { DEFAULT_IMAGE_DESCRIPTION, DEFAULT_IMAGE_PROMPT_EN, DEFAULT_IMAGE_TAGS, getImageAIConfig, saveImageAIConfig, type ImageAIConfig, type ImageAITask } from '@/api/imageAi'
import { useGlobalStore } from '@/store/useGlobalStore'

const global = useGlobalStore()
const modelStatus = ref<Partial<Record<QwenModelKind, QwenStatus>>>({})
const modelManager = ref<QwenModelManager>()
const modelPath = ref<Record<QwenModelKind, string>>({ embedding: '', reranker: '', instruct: '' })
const selectedSize = ref<Record<QwenModelKind, QwenModelSize>>({ embedding: '2B', reranker: '2B', instruct: '2B' })
const modelSaving = ref<QwenModelKind>()
const modelIndexing = ref(false)
const modelError = ref('')
const modelCards: {kind: 'embedding' | 'reranker'; title: string; description: string; note: string}[] = [
  { kind: 'embedding', title: '图文检索模型', description: '用文字找画面，也用于以图搜图。', note: '换模型后需重建图片索引。' },
  { kind: 'reranker', title: '图片重排模型', description: '对检索出的图片再次评分，调整结果顺序。', note: '目前重排文字搜索的前 20 张候选图。' },
]
const resources = [
  { size: '2B', disk: '约 4–5 GB', vram: '建议 8 GB', ram: '建议 16 GB' },
  { size: '8B', disk: '约 16–18 GB', vram: '建议 24 GB', ram: '建议 32 GB' },
]
const content = ref<ImageAIConfig>({
  provider: 'local', openrouter_model: 'qwen/qwen3-vl-8b-instruct',
  prompts: { description: DEFAULT_IMAGE_DESCRIPTION, prompt: DEFAULT_IMAGE_PROMPT_EN, tags: DEFAULT_IMAGE_TAGS },
  api_key_configured: false, api_key_source: 'none',
})
const promptTask = ref<ImageAITask>('description')
const promptTabs: {task: ImageAITask; label: string; hint: string}[] = [
  { task: 'description', label: '描述', hint: '{max_chars} 是预览中选择的长度' },
  { task: 'prompt', label: '提示词反推', hint: '{max_chars} 当前为 600' },
  { task: 'tags', label: '标签推荐', hint: '{allowed_tags} 是已有自定义标签' },
]
const contentLoaded = ref(false)
const apiKeyDraft = ref('')
const contentSaving = ref(false)
const contentError = ref('')
let timer: ReturnType<typeof setInterval> | undefined

function modelName(kind: QwenModelKind, size: QwenModelSize) {
  return kind === 'instruct' ? `Qwen3-VL-${size}-Instruct` : `Qwen3-VL-${kind === 'embedding' ? 'Embedding' : 'Reranker'}-${size}`
}

function choice(kind: QwenModelKind) {
  return modelManager.value?.models[kind]?.find(option => option.size === selectedSize.value[kind])
}

async function refreshModels(syncPath = false) {
  try {
    const wasDownloading = modelManager.value?.job.running
    const [embedding, reranker, instruct, manager] = await Promise.all([
      getQwenStatus('embedding'), getQwenStatus('reranker'), getQwenStatus('instruct'), getQwenModels(),
    ])
    const next = { embedding, reranker, instruct }
    if (syncPath || (wasDownloading && !manager.job.running) || !modelManager.value) {
      for (const kind of ['embedding', 'reranker', 'instruct'] as QwenModelKind[]) {
        modelPath.value[kind] = next[kind].model_path
        selectedSize.value[kind] = next[kind].model.includes('8B') ? '8B' : '2B'
      }
    }
    modelStatus.value = next
    modelManager.value = manager
    modelError.value = ''
  } catch (cause: any) {
    modelError.value = cause?.response?.data?.detail || cause?.message || '读取模型状态失败'
  }
}

async function saveModelPath(kind: QwenModelKind, reset = false) {
  if (global.conf?.is_readonly || modelSaving.value) return
  modelSaving.value = kind
  try {
    await saveQwenConfig(kind, reset ? '' : modelPath.value[kind].trim())
    await refreshModels(true)
    message.success(reset ? '已恢复默认目录' : '模型目录已保存')
  } catch (cause: any) {
    modelError.value = cause?.response?.data?.detail || cause?.message || '保存模型目录失败'
  } finally { modelSaving.value = undefined }
}

async function useModel(kind: QwenModelKind) {
  if (global.conf?.is_readonly || modelSaving.value || modelManager.value?.job.running) return
  modelSaving.value = kind
  try {
    await selectQwenModel(kind, selectedSize.value[kind])
    await refreshModels(true)
    message.success('已切换模型')
  } catch (cause: any) {
    modelError.value = cause?.response?.data?.detail || cause?.message || '切换模型失败'
  } finally { modelSaving.value = undefined }
}

async function downloadModel(kind: QwenModelKind) {
  if (global.conf?.is_readonly || modelManager.value?.job.running) return
  try {
    modelManager.value = await installQwenModel(kind, selectedSize.value[kind])
    modelError.value = ''
  } catch (cause: any) {
    modelError.value = cause?.response?.data?.detail || cause?.message || '启动下载失败'
  }
}

async function buildIndex() {
  if (global.conf?.is_readonly || modelIndexing.value) return
  modelIndexing.value = true
  try { await startQwenIndex(); await refreshModels() }
  catch (cause: any) { modelError.value = cause?.response?.data?.detail || cause?.message || '启动图片索引失败' }
  finally { modelIndexing.value = false }
}

async function refreshContent() {
  try {
    const config = await getImageAIConfig()
    content.value = { ...config, prompts: { ...config.prompts } }
    apiKeyDraft.value = ''
    contentLoaded.value = true
    contentError.value = ''
  } catch (cause: any) {
    contentError.value = cause?.response?.data?.detail || cause?.message || '读取内容处理配置失败'
  }
}

async function saveContent(clearApiKey = false) {
  if (global.conf?.is_readonly || contentSaving.value) return
  contentSaving.value = true
  contentError.value = ''
  try {
    const saved = await saveImageAIConfig({
      provider: content.value.provider, openrouter_model: content.value.openrouter_model.trim(),
      prompts: { ...content.value.prompts },
      ...(clearApiKey ? { clear_api_key: true } : apiKeyDraft.value.trim() ? { api_key: apiKeyDraft.value.trim() } : {}),
    })
    content.value = { ...saved, prompts: { ...saved.prompts } }
    apiKeyDraft.value = ''
    message.success(clearApiKey ? '已清除保存的 API Key' : '配置已保存')
  } catch (cause: any) {
    contentError.value = cause?.response?.data?.detail || cause?.message || '保存配置失败'
  } finally { contentSaving.value = false }
}

function resetPrompts() {
  content.value.prompts = { description: DEFAULT_IMAGE_DESCRIPTION, prompt: DEFAULT_IMAGE_PROMPT_EN, tags: DEFAULT_IMAGE_TAGS }
}

onMounted(() => {
  void refreshModels(true)
  void refreshContent()
  timer = setInterval(() => {
    if (modelManager.value?.job.running || modelStatus.value.embedding?.running) void refreshModels()
  }, 2000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="ai-settings">
    <article v-for="card in modelCards" :key="card.kind" class="ai-card">
      <header><div><h3>{{ card.title }}</h3><p>{{ card.description }}</p></div><span class="state-badge" :class="{ready: modelStatus[card.kind]?.state === 'ready'}">{{ modelStatus[card.kind]?.state === 'ready' ? '本地就绪' : '待配置' }}</span></header>
      <div class="card-layout">
        <div class="model-controls">
          <label class="field-label" :for="`model-${card.kind}`">Qwen3-VL 型号</label>
          <div class="variant-row">
            <select :id="`model-${card.kind}`" v-model="selectedSize[card.kind]" class="provider-select" :disabled="!!modelManager?.job.running"><option value="2B">{{ modelName(card.kind, '2B') }} · 默认</option><option value="8B">{{ modelName(card.kind, '8B') }}</option></select>
            <a-button v-if="choice(card.kind)?.installed" :loading="modelSaving === card.kind" :disabled="!!global.conf?.is_readonly || choice(card.kind)?.active || !!modelManager?.job.running" @click="useModel(card.kind)">{{ choice(card.kind)?.active ? '使用中' : '启用' }}</a-button>
            <a-button v-else type="primary" :disabled="!!global.conf?.is_readonly || !!modelManager?.job.running" @click="downloadModel(card.kind)">下载并安装</a-button>
          </div>
          <p class="status-line" :class="modelStatus[card.kind]?.state === 'ready' ? 'status-ok' : 'status-warn'">{{ modelStatus[card.kind]?.state === 'ready' ? `当前：${modelStatus[card.kind]?.model?.replace('Qwen/', '')}` : modelStatus[card.kind]?.detail || '正在读取模型状态…' }}</p>
          <p v-if="modelManager?.job.kind === card.kind && modelManager.job.running" class="status-line">{{ modelManager.job.stage }}</p>
          <p v-if="modelManager?.job.kind === card.kind && modelManager.job.error" class="status-line status-warn">{{ modelManager.job.error }}</p>
          <details class="advanced"><summary>使用已有模型目录</summary><div class="path-control"><a-input v-model:value="modelPath[card.kind]" :disabled="!!modelSaving || !!global.conf?.is_readonly" placeholder="后端可访问的完整目录" /><a-button :loading="modelSaving === card.kind" :disabled="!!global.conf?.is_readonly || !modelPath[card.kind]?.trim() || modelPath[card.kind].trim() === modelStatus[card.kind]?.model_path" @click="saveModelPath(card.kind)">保存目录</a-button><a-button :disabled="!!global.conf?.is_readonly || modelStatus[card.kind]?.config_source !== 'settings'" @click="saveModelPath(card.kind, true)">恢复默认</a-button></div></details>
          <div class="model-actions"><template v-if="card.kind === 'embedding'"><span>已索引 {{ modelStatus.embedding?.indexed_count ?? 0 }} / {{ modelStatus.embedding?.image_count ?? 0 }} 张</span><a-button size="small" :loading="modelIndexing || modelStatus.embedding?.running" :disabled="modelStatus.embedding?.state !== 'ready' || !!global.conf?.is_readonly" @click="buildIndex">更新索引</a-button></template><span>{{ card.note }}</span></div>
        </div>
        <aside class="resource-list"><h4>资源参考</h4><ul><li v-for="item in resources" :key="item.size"><strong>{{ item.size }}</strong><span>磁盘 {{ item.disk }}</span><span>显存 {{ item.vram }}</span><span>内存 {{ item.ram }}</span></li></ul><small>估算值；实际占用因图片和设备而异。</small></aside>
      </div>
    </article>
    <a-alert v-if="modelError" type="error" :message="modelError" show-icon />

    <article class="ai-card">
      <header><div><h3>图片内容处理模型</h3><p>生成描述、反推提示词、推荐已有标签。</p></div><span class="state-badge" :class="{ready: content.provider === 'local' ? modelStatus.instruct?.state === 'ready' : content.api_key_configured}">{{ content.provider === 'local' ? modelStatus.instruct?.state === 'ready' ? '本地就绪' : '待配置' : content.api_key_configured ? 'API 已配置' : '待配置' }}</span></header>
      <div class="provider-row"><label class="field-label" for="image-ai-provider">接入方式</label><select id="image-ai-provider" v-model="content.provider" class="provider-select" :disabled="!contentLoaded || contentSaving || !!global.conf?.is_readonly"><option value="local">本地模型</option><option value="openrouter">OpenRouter API</option></select></div>
      <div v-if="content.provider === 'local'" class="card-layout">
        <div class="model-controls">
          <label class="field-label" for="model-instruct">Qwen3-VL 型号</label>
          <div class="variant-row"><select id="model-instruct" v-model="selectedSize.instruct" class="provider-select" :disabled="!!modelManager?.job.running"><option value="2B">{{ modelName('instruct', '2B') }} · 默认</option><option value="8B">{{ modelName('instruct', '8B') }}</option></select><a-button v-if="choice('instruct')?.installed" :loading="modelSaving === 'instruct'" :disabled="!!global.conf?.is_readonly || choice('instruct')?.active || !!modelManager?.job.running" @click="useModel('instruct')">{{ choice('instruct')?.active ? '使用中' : '启用' }}</a-button><a-button v-else type="primary" :disabled="!!global.conf?.is_readonly || !!modelManager?.job.running" @click="downloadModel('instruct')">下载并安装</a-button></div>
          <p class="status-line" :class="modelStatus.instruct?.state === 'ready' ? 'status-ok' : 'status-warn'">{{ modelStatus.instruct?.state === 'ready' ? `当前：${modelStatus.instruct?.model?.replace('Qwen/', '')}` : modelStatus.instruct?.detail || '正在读取模型状态…' }}</p>
          <p v-if="modelManager?.job.kind === 'instruct' && modelManager.job.running" class="status-line">{{ modelManager.job.stage }}</p><p v-if="modelManager?.job.kind === 'instruct' && modelManager.job.error" class="status-line status-warn">{{ modelManager.job.error }}</p>
          <details class="advanced"><summary>使用已有模型目录</summary><div class="path-control"><a-input v-model:value="modelPath.instruct" :disabled="!!modelSaving || !!global.conf?.is_readonly" placeholder="后端可访问的完整目录" /><a-button :loading="modelSaving === 'instruct'" :disabled="!!global.conf?.is_readonly || !modelPath.instruct.trim() || modelPath.instruct.trim() === modelStatus.instruct?.model_path" @click="saveModelPath('instruct')">保存目录</a-button><a-button :disabled="!!global.conf?.is_readonly || modelStatus.instruct?.config_source !== 'settings'" @click="saveModelPath('instruct', true)">恢复默认</a-button></div></details>
        </div>
        <aside class="resource-list"><h4>资源参考</h4><ul><li v-for="item in resources" :key="item.size"><strong>{{ item.size }}</strong><span>磁盘 {{ item.disk }}</span><span>显存 {{ item.vram }}</span><span>内存 {{ item.ram }}</span></li></ul><small>三种本地模型按需加载。</small></aside>
      </div>
      <div v-else class="api-config"><p class="compact-help">填写支持图片输入的模型 ID。生成时会把缩放后的图片发送给 OpenRouter；无需本地模型显存。</p><label class="field-label" for="openrouter-model">OpenRouter 模型 ID</label><a-input id="openrouter-model" v-model:value="content.openrouter_model" :disabled="contentSaving || !!global.conf?.is_readonly" placeholder="qwen/qwen3-vl-8b-instruct" /><label class="field-label" for="openrouter-key">API Key</label><div class="path-control"><a-input-password id="openrouter-key" v-model:value="apiKeyDraft" :disabled="contentSaving || !!global.conf?.is_readonly" autocomplete="new-password" placeholder="留空则保持现有 Key" /><a-button v-if="content.api_key_source === 'saved'" :disabled="contentSaving || !!global.conf?.is_readonly" @click="saveContent(true)">清除 Key</a-button></div><p class="compact-help">{{ content.api_key_configured ? 'API Key 已配置，页面不回显。' : '未配置 Key；也可设置后端环境变量 OPENROUTER_API_KEY。' }} <a href="https://openrouter.ai/models?input_modalities=image%2Ctext" target="_blank" rel="noopener noreferrer">查看视觉模型</a></p></div>

      <div class="prompt-section"><div class="prompt-heading"><div><h4>默认系统提示词</h4><p>适用于当前接入方式；预览中可临时修改反推指令。</p></div><a-button size="small" :disabled="contentSaving || !!global.conf?.is_readonly" @click="resetPrompts">恢复预设</a-button></div><div class="prompt-tabs" role="tablist" aria-label="系统提示词任务"><button v-for="tab in promptTabs" :key="tab.task" type="button" role="tab" :aria-selected="promptTask === tab.task" :class="{active: promptTask === tab.task}" @click="promptTask = tab.task">{{ tab.label }}</button></div><p class="compact-help">{{ promptTabs.find(tab => tab.task === promptTask)?.hint }}</p><a-textarea v-model:value="content.prompts[promptTask]" :disabled="contentSaving || !!global.conf?.is_readonly" :rows="4" :maxlength="2000" :aria-label="`默认${promptTabs.find(tab => tab.task === promptTask)?.label}系统提示词`" /></div>
      <div class="save-actions"><a-button type="primary" :loading="contentSaving" :disabled="!contentLoaded || !!global.conf?.is_readonly || !content.openrouter_model.trim() || !content.prompts.description.trim() || !content.prompts.prompt.trim() || !content.prompts.tags.trim()" @click="saveContent()">保存内容处理配置</a-button><a-button @click="refreshContent">重新读取</a-button></div>
      <a-alert v-if="contentError" type="error" :message="contentError" show-icon />
    </article>
  </div>
</template>

<style scoped>
.ai-settings { display: flex; flex-direction: column; gap: 14px; width: 100%; min-width: 0; container-type: inline-size; }
.ai-card { padding: 18px; border: 1px solid var(--zp-border); border-radius: 8px; background: var(--zp-primary-background); }
.ai-card header { display: flex; justify-content: space-between; gap: 12px; align-items: start; margin-bottom: 12px; }
.ai-card h3 { font-size: 15px; margin: 0 0 3px; font-weight: 600; }
.ai-card header p { font-size: 12px; color: var(--zp-secondary); margin: 0; }
.state-badge { flex: none; padding: 3px 8px; border-radius: 20px; background: var(--zp-secondary-background); color: var(--zp-secondary); font-size: 11px; }
.state-badge.ready { background: var(--primary-color-1); color: var(--primary-color); }
.card-layout { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 18px; }
.model-controls { min-width: 0; }
.field-label { display: block; font-size: 12px; font-weight: 600; margin: 4px 0 7px; }
.variant-row, .provider-row, .path-control, .model-actions, .save-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.variant-row .provider-select { flex: 1; min-width: 180px; }
.provider-select { padding: 6px 8px; border: 1px solid var(--zp-border); border-radius: 6px; background: var(--zp-primary-background); color: inherit; }
.status-line, .compact-help { font-size: 12px; line-height: 1.5; color: var(--zp-secondary); margin: 9px 0; }
.status-ok { color: #237804; }
.status-warn { color: #ad6800; }
.advanced { font-size: 12px; color: var(--zp-secondary); margin: 12px 0; }
.advanced summary { cursor: pointer; }
.path-control { margin: 8px 0; }
.path-control :deep(.ant-input-affix-wrapper), .path-control > .ant-input { flex: 1 1 250px; min-width: 0; }
.model-actions { font-size: 12px; color: var(--zp-secondary); margin-top: 10px; }
.resource-list { padding: 10px 12px; background: var(--zp-secondary-background); border-radius: 7px; align-self: start; color: var(--zp-secondary); }
.resource-list h4 { font-size: 12px; margin: 0 0 8px; color: inherit; }
.resource-list ul { list-style: none; margin: 0; padding: 0; }
.resource-list li { display: flex; flex-direction: column; gap: 2px; font-size: 11px; line-height: 1.35; padding: 6px 0; border-top: 1px solid var(--zp-border); }
.resource-list li strong { font-size: 12px; color: var(--primary-color); }
.resource-list small { display: block; font-size: 10px; line-height: 1.4; margin-top: 6px; }
.provider-row { margin-bottom: 14px; }
.provider-row .field-label { margin: 0; }
.api-config { width: 100%; min-width: 0; }
.api-config .field-label { margin-top: 12px; }
.api-config a { color: var(--primary-color); }
.prompt-section { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--zp-border); }
.prompt-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.prompt-heading h4 { font-size: 13px; margin: 0; }
.prompt-heading p { font-size: 11px; color: var(--zp-secondary); margin: 4px 0 9px; }
.prompt-tabs { display: flex; gap: 5px; }
.prompt-tabs button { border: 1px solid var(--zp-border); background: var(--zp-primary-background); color: inherit; padding: 4px 10px; border-radius: 5px; font-size: 12px; cursor: pointer; }
.prompt-tabs button.active { border-color: var(--primary-color); color: var(--primary-color); background: var(--primary-color-1); }
.prompt-section :deep(textarea) { font-size: 12px; line-height: 1.5; }
.save-actions { margin-top: 14px; }
.ai-settings{gap:16px;}
.ai-card{padding:20px;border-radius:var(--ui-radius);background:var(--ui-surface);}
.ai-card header{align-items:center;padding-bottom:12px;border-bottom:1px solid var(--ui-border);}
.ai-card h3{font-size:14px;letter-spacing:-.01em;}
.provider-select{min-height:34px;padding-inline:10px;border-radius:var(--ui-radius-sm);background:var(--ui-surface-soft);transition:border-color var(--ui-motion-fast) var(--ui-ease),box-shadow var(--ui-motion-fast) var(--ui-ease);}
.provider-select:focus-visible{border-color:var(--primary-color);box-shadow:0 0 0 3px var(--primary-color-1);}
.resource-list{border:1px solid var(--ui-border);border-radius:var(--ui-radius);background:var(--ui-surface-soft);}
.advanced summary{padding:6px 0;color:var(--ui-text);font-weight:500;}
.prompt-tabs button{border-radius:var(--ui-radius-sm);transition:background-color var(--ui-motion-fast) var(--ui-ease),border-color var(--ui-motion-fast) var(--ui-ease);}
.state-badge{font-weight:500;}
@container (max-width: 720px) {
  .card-layout { grid-template-columns: 1fr; }
  .resource-list ul { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .resource-list li { border-top: 0; }
  .ai-card { padding: 14px; }
}
</style>
