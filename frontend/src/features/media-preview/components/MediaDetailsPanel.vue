<script setup lang="ts">
import { ref, toRefs, watch } from 'vue'
import type { UnwrapNestedRefs } from 'vue'
import type { usePreviewMetadata } from '../composables/usePreviewMetadata'
import type { MediaPreviewItem } from '../model/useMediaPreviewStore'
import { useApplicationStore } from '@/features/application/public'
import { useTagStore } from '@/features/media-library/public'
import { copy2clipboardI18n } from '@/shared/lib/clipboard'
import { tagLabel } from '@/features/media-library/public'
import { DEFAULT_IMAGE_PROMPT_EN, DEFAULT_IMAGE_PROMPT_ZH } from '@/features/ai-workflows/public'
import MediaMetadataEditForm from './MediaMetadataEditForm.vue'
import MediaMetadataEditPopover from './MediaMetadataEditPopover.vue'
import AudioMetadataPanel from './AudioMetadataPanel.vue'
import type { AudioMetadata } from '@/features/media-library/public'
import GenerationInfoEditor from '@/features/generation-metadata/components/GenerationInfoEditor.vue'
import {
  generationFieldLabel,
  generationFieldTooltip,
  generationResourceLabel
} from '@/features/generation-metadata/public'
import {
  EditOutlined,
  RightOutlined,
  ExclamationCircleOutlined,
  RobotOutlined,
  PlusOutlined,
  CopyOutlined,
  TagsOutlined
} from '@ant-design/icons-vue'
const props = defineProps<{
  session: UnwrapNestedRefs<ReturnType<typeof usePreviewMetadata>>
  currentItem: MediaPreviewItem | null
  detailsOpen: boolean
  editingImage: boolean
  isAnimating: boolean
  fileDetails: { label: string; value: unknown }[]
  exifDetails: { label: string; value: string }[]
  audioMetadata?: AudioMetadata
  audioLoading: boolean
  audioError: string
  beforeAudioSave: () => Promise<void>
}>()
const activeDetailsTab = defineModel<'description' | 'generation' | 'metadata'>('activeTab', {
  required: true
})
const emit = defineEmits<{
  toggleDetails: []
  editMetadata: []
  reloadAudio: []
  audioUpdated: [metadata: AudioMetadata]
  audioEditing: [value: boolean]
  audioSettled: []
}>()
const global = useApplicationStore()
const tagStore = useTagStore()
function popupContainer() {
  return document.fullscreenElement instanceof HTMLElement
    ? document.fullscreenElement
    : document.body
}
const {
  editorOpen,
  promptLoading,
  promptError,
  imageDescription,
  descriptionLoading,
  descriptionSaving,
  descriptionEditing,
  descriptionAvailable,
  descriptionError,
  aiDescriptionLength,
  aiDescriptionOpen,
  aiDescriptionTemplate,
  aiPromptSaved,
  aiPromptEditing,
  aiPromptOpen,
  aiPromptLength,
  inlineField,
  addGenerationFieldOpen,
  resourcesExpanded,
  aiPromptTemplate,
  aiPromptDefault,
  aiTagSuggestions,
  aiLoadingTask,
  aiSavingPrompt,
  aiError,
  metadataLoading,
  metadataError,
  isTagSelected,
  onTagClick,
  tagBaseStyle,
  geninfoStruct,
  comfyWorkflow,
  copyableGenInfo,
  primaryParams,
  modelResources,
  visibleResources,
  visiblePrompts,
  missingGenerationFields,
  hasGenerationContent,
  canEditInline,
  loadCurrentItemPrompt,
  loadCurrentItemDescription,
  loadCurrentItemMetadata,
  editDescription,
  beginInline,
  confirmAiPrompt,
  confirmAiDescription,
  generateAiSuggestion,
  editAiPrompt,
  applyAiTag,
  suggestedTagLabel
} = toRefs(props.session)

const editAnchor = ref('')
const rawEditor = ref<InstanceType<typeof GenerationInfoEditor>>()
function editAt(anchor: string, action: () => void) {
  if (props.session.editorOpen) return
  if (!props.session.cancelMetadataEdit()) return
  editAnchor.value = anchor
  action()
}
function closeEdit() {
  props.session.cancelMetadataEdit()
}
function setAiOpen(kind: 'description' | 'reference', open: boolean) {
  if (!open) {
    if (editAnchor.value === `${kind}-ai`) closeEdit()
    return
  }
  if (props.session.editorOpen) return
  if (!props.session.cancelMetadataEdit()) return
  editAnchor.value = `${kind}-ai`
  if (kind === 'description') aiDescriptionOpen.value = true
  else aiPromptOpen.value = true
}
function setAddOpen(open: boolean) {
  if (!open) {
    if (editAnchor.value === 'generation-add') closeEdit()
    return
  }
  if (props.session.editorOpen) return
  if (!props.session.cancelMetadataEdit()) return
  editAnchor.value = 'generation-add'
  addGenerationFieldOpen.value = true
}
function setRawOpen(open: boolean) {
  if (!open) rawEditor.value?.cancel()
}
function openRawEditor() {
  if (props.session.editorOpen || !props.session.cancelMetadataEdit()) return
  emit('editMetadata')
}
watch(
  () => [props.detailsOpen, activeDetailsTab.value],
  () => {
    closeEdit()
    if (!props.detailsOpen) editorOpen.value = false
  }
)
</script>
<template>
  <aside
    id="preview-details"
    class="preview-tags-panel preview-panel-surface"
    aria-label="媒体详细信息"
    :aria-hidden="!detailsOpen || editingImage"
    :inert="!detailsOpen || editingImage"
    @click.stop
    @touchstart.stop
    @touchmove.stop
    @wheel.stop
  >
    <div class="panel-header">
      <div class="panel-title"><ExclamationCircleOutlined /><span>详细信息</span></div>
      <button
        type="button"
        class="details-collapse"
        aria-label="收起详细信息"
        title="收起详细信息"
        aria-controls="preview-details"
        :aria-expanded="true"
        @click="emit('toggleDetails')"
      >
        <RightOutlined />
      </button>
    </div>
    <div class="details-filename" :title="currentItem?.name">{{ currentItem?.name }}</div>
    <nav class="details-tabs" role="tablist" aria-label="详细信息分类">
      <button
        type="button"
        role="tab"
        :disabled="session.editorOpen"
        :aria-selected="activeDetailsTab === 'description'"
        :class="{ active: activeDetailsTab === 'description' }"
        @click="activeDetailsTab = 'description'"
      >
        描述
      </button>
      <button
        type="button"
        role="tab"
        :disabled="session.editorOpen"
        :aria-selected="activeDetailsTab === 'generation'"
        :class="{ active: activeDetailsTab === 'generation' }"
        @click="activeDetailsTab = 'generation'"
      >
        生成信息
      </button>
      <button
        type="button"
        role="tab"
        :disabled="session.editorOpen"
        :aria-selected="activeDetailsTab === 'metadata'"
        :class="{ active: activeDetailsTab === 'metadata' }"
        @click="activeDetailsTab = 'metadata'"
      >
        元信息
      </button>
    </nav>
    <div v-if="activeDetailsTab === 'generation'" class="metadata-actions generation-actions">
      <a-popover
        v-if="!global.conf?.is_readonly"
        :open="addGenerationFieldOpen || (!!inlineField && editAnchor === 'generation-add')"
        trigger="click"
        placement="bottomLeft"
        overlay-class-name="preview-metadata-edit-popover"
        :get-popup-container="popupContainer"
        :z-index="1010"
        destroy-tooltip-on-hide
        @open-change="setAddOpen"
      >
        <template #content>
          <MediaMetadataEditForm
            v-if="inlineField && editAnchor === 'generation-add'"
            :session="session"
            kind="generation"
          />
          <div
            v-else
            class="generation-add-menu"
            @keydown.stop
            @keydown.esc="addGenerationFieldOpen = false"
            @wheel.stop
          >
            <button
              :disabled="!canEditInline || !!inlineField"
              title="使用资源"
              aria-label="使用资源"
              @click="editAt('generation-add', () => beginInline('__resource'))"
            >
              使用资源…</button
            ><button
              v-for="field in missingGenerationFields"
              :key="field.key"
              :title="generationFieldTooltip(field.key)"
              :aria-label="generationFieldTooltip(field.key)"
              @click="editAt('generation-add', () => beginInline(field.key))"
            >
              {{ generationFieldLabel(field.key) }}
            </button>
          </div>
        </template>
        <button
          class="generation-add-trigger"
          :disabled="!canEditInline"
          aria-label="补充生成信息"
          title="补充生成信息"
        >
          <PlusOutlined />
        </button>
      </a-popover>
      <button
        :disabled="!copyableGenInfo || promptLoading"
        aria-label="复制全部生成信息（不含模型和 LoRA 名称）"
        title="复制全部（不含模型与 LoRA）"
        @click="copy2clipboardI18n(copyableGenInfo)"
      >
        <CopyOutlined />
      </button>
      <a-popover
        :open="session.editorOpen"
        trigger="click"
        placement="bottomRight"
        overlay-class-name="preview-metadata-edit-popover"
        :get-popup-container="popupContainer"
        :z-index="1010"
        destroy-tooltip-on-hide
        @open-change="setRawOpen"
      >
        <template #content>
          <GenerationInfoEditor
            ref="rawEditor"
            :open="session.editorOpen"
            :path="session.editTarget.path"
            :name="session.editTarget.name"
            :raw="session.editTarget.raw"
            :artifact-id="session.editTarget.artifactId"
            raw-only
            @close="editorOpen = false"
            @saved="loadCurrentItemPrompt(true)"
          />
        </template>
        <button
          :disabled="
            global.conf?.is_readonly || promptLoading || promptError || isAnimating || !!inlineField
          "
          aria-label="编辑原始生成信息"
          title="编辑原始生成信息"
          @click="openRawEditor"
        >
          <EditOutlined />
        </button>
      </a-popover>
    </div>
    <div class="panel-body" role="tabpanel">
      <template v-if="activeDetailsTab === 'description'">
        <section class="panel-section description-section">
          <div class="section-title">
            <span>媒体描述</span>
            <div v-if="descriptionAvailable" class="generation-heading-actions">
              <button
                v-if="imageDescription"
                :disabled="descriptionLoading || descriptionError"
                aria-label="复制媒体描述"
                title="复制媒体描述"
                @click="copy2clipboardI18n(imageDescription)"
              >
                <CopyOutlined />
              </button>
              <MediaMetadataEditPopover
                v-if="!global.conf?.is_readonly"
                :session="session"
                kind="description"
                :open="descriptionEditing && editAnchor === 'description-heading'"
                @dismiss="closeEdit"
              >
                <button
                  :disabled="descriptionLoading || descriptionError"
                  aria-label="编辑媒体描述"
                  title="编辑媒体描述"
                  @click="editAt('description-heading', editDescription)"
                >
                  <EditOutlined />
                </button>
              </MediaMetadataEditPopover>
              <a-popover
                v-if="currentItem?.type === 'image' && !global.conf?.is_readonly"
                :open="aiDescriptionOpen || (descriptionEditing && editAnchor === 'description-ai')"
                trigger="click"
                placement="bottomRight"
                overlay-class-name="preview-ai-popover"
                :get-popup-container="popupContainer"
                :z-index="1010"
                destroy-tooltip-on-hide
                @open-change="setAiOpen('description', $event)"
              >
                <template #content>
                  <MediaMetadataEditForm
                    v-if="descriptionEditing && editAnchor === 'description-ai'"
                    :session="session"
                    kind="description"
                  />
                  <div
                    v-else
                    class="description-ai-confirm"
                    @keydown.stop
                    @keydown.esc="aiDescriptionOpen = false"
                    @wheel.stop
                  >
                    <strong>AI 描述建议</strong>
                    <div class="description-ai-field">
                      <label for="description-ai-prompt">提示词</label>
                      <a-textarea
                        id="description-ai-prompt"
                        v-model:value="aiDescriptionTemplate"
                        :rows="5"
                        :maxlength="2000"
                      />
                    </div>
                    <div class="description-ai-options">
                      <label for="description-ai-length">建议长度</label
                      ><select id="description-ai-length" v-model.number="aiDescriptionLength">
                        <option :value="80">80 字</option>
                        <option :value="120">120 字</option>
                        <option :value="200">200 字</option>
                      </select>
                    </div>
                    <p>生成后填入编辑区，保存描述后生效。</p>
                    <div class="description-ai-footer">
                      <a-button @click="aiDescriptionOpen = false">取消</a-button
                      ><a-button
                        type="primary"
                        :disabled="
                          !aiDescriptionTemplate.trim() || !!aiLoadingTask || descriptionSaving
                        "
                        @click="editAt('description-ai', confirmAiDescription)"
                        >生成并填入</a-button
                      >
                    </div>
                  </div>
                </template>
                <button
                  :disabled="
                    !!aiLoadingTask || descriptionSaving || descriptionLoading || descriptionError
                  "
                  aria-label="AI 描述建议"
                  :title="aiLoadingTask === 'description' ? '生成中…' : 'AI 描述建议'"
                >
                  <RobotOutlined :spin="aiLoadingTask === 'description'" />
                </button>
              </a-popover>
              <button
                v-if="currentItem?.type === 'audio' || currentItem?.type === 'video'"
                disabled
                aria-label="AI 描述建议（暂未开放）"
                title="AI 描述建议暂未开放"
              >
                <RobotOutlined />
              </button>
            </div>
          </div>
          <p v-if="descriptionLoading" class="prompt-empty">正在读取描述…</p>
          <p v-else-if="!descriptionAvailable" class="prompt-empty">加入媒体索引后可填写描述</p>
          <p v-else-if="descriptionError" class="prompt-empty">
            描述读取失败
            <button class="metadata-retry" @click="loadCurrentItemDescription">重试</button>
          </p>
          <MediaMetadataEditPopover
            v-else
            :session="session"
            kind="description"
            :open="descriptionEditing && editAnchor === 'description-text'"
            @dismiss="closeEdit"
          >
            <GenerationPromptText
              v-if="imageDescription"
              :text="imageDescription"
              label="媒体描述"
              :disabled="!!global.conf?.is_readonly || descriptionSaving"
              @edit="editAt('description-text', editDescription)"
            />
            <button
              v-else
              class="metadata-empty"
              :disabled="global.conf?.is_readonly"
              @click="editAt('description-text', editDescription)"
            >
              未填写 · 点击添加描述
            </button>
          </MediaMetadataEditPopover>
        </section>
        <section v-if="currentItem?.type === 'image'" class="panel-section ai-prompt-section">
          <div class="section-title">
            <span>AI 参考提示词</span>
            <div class="generation-heading-actions">
              <button
                v-if="aiPromptSaved"
                aria-label="复制参考提示词"
                title="复制参考提示词"
                @click="copy2clipboardI18n(aiPromptSaved)"
              >
                <CopyOutlined />
              </button>
              <MediaMetadataEditPopover
                v-if="!global.conf?.is_readonly"
                :session="session"
                kind="reference"
                :open="aiPromptEditing && editAnchor === 'reference-heading'"
                @dismiss="closeEdit"
              >
                <button
                  :disabled="!!aiLoadingTask || aiSavingPrompt"
                  aria-label="编辑参考提示词"
                  title="编辑参考提示词"
                  @click="editAt('reference-heading', editAiPrompt)"
                >
                  <EditOutlined />
                </button>
              </MediaMetadataEditPopover>
              <a-popover
                v-if="currentItem?.type === 'image'"
                :open="aiPromptOpen || (aiPromptEditing && editAnchor === 'reference-ai')"
                trigger="click"
                placement="bottomRight"
                overlay-class-name="preview-ai-popover"
                :get-popup-container="popupContainer"
                :z-index="1010"
                destroy-tooltip-on-hide
                @open-change="setAiOpen('reference', $event)"
              >
                <template #content>
                  <MediaMetadataEditForm
                    v-if="aiPromptEditing && editAnchor === 'reference-ai'"
                    :session="session"
                    kind="reference"
                  />
                  <div
                    v-else
                    class="description-ai-confirm"
                    @keydown.stop
                    @keydown.esc="aiPromptOpen = false"
                    @wheel.stop
                  >
                    <strong>AI 反推参考提示词</strong>
                    <div class="ai-prompt-presets">
                      <a-button size="small" @click="aiPromptTemplate = DEFAULT_IMAGE_PROMPT_ZH"
                        >中文</a-button
                      ><a-button size="small" @click="aiPromptTemplate = DEFAULT_IMAGE_PROMPT_EN"
                        >English</a-button
                      ><a-button size="small" @click="aiPromptTemplate = aiPromptDefault"
                        >设置默认</a-button
                      >
                    </div>
                    <div class="description-ai-field">
                      <label for="ai-prompt-template">提示词</label>
                      <a-textarea
                        id="ai-prompt-template"
                        v-model:value="aiPromptTemplate"
                        :rows="5"
                        :maxlength="2000"
                      />
                    </div>
                    <div class="description-ai-options">
                      <label for="ai-prompt-length">建议长度</label
                      ><select id="ai-prompt-length" v-model.number="aiPromptLength">
                        <option :value="300">300 字</option>
                        <option :value="600">600 字</option>
                        <option :value="1000">1000 字</option>
                      </select>
                    </div>
                    <p>结果填入参考提示词，与原始生成信息分开保存。</p>
                    <div class="description-ai-footer">
                      <a-button @click="aiPromptOpen = false">取消</a-button
                      ><a-button
                        type="primary"
                        :disabled="!aiPromptTemplate.trim() || !!aiLoadingTask || aiSavingPrompt"
                        @click="editAt('reference-ai', confirmAiPrompt)"
                        >生成并填入</a-button
                      >
                    </div>
                  </div>
                </template>
                <button
                  :disabled="!!aiLoadingTask || aiSavingPrompt || !!inlineField"
                  aria-label="AI 反推参考提示词"
                  :title="aiLoadingTask === 'prompt' ? '生成中…' : 'AI 反推参考提示词'"
                >
                  <RobotOutlined :spin="aiLoadingTask === 'prompt'" />
                </button>
              </a-popover>
            </div>
          </div>
          <MediaMetadataEditPopover
            :session="session"
            kind="reference"
            :open="aiPromptEditing && editAnchor === 'reference-text'"
            @dismiss="closeEdit"
          >
            <GenerationPromptText
              v-if="aiPromptSaved"
              :text="aiPromptSaved"
              label="参考提示词"
              :disabled="!!global.conf?.is_readonly || !!aiLoadingTask || aiSavingPrompt"
              @edit="editAt('reference-text', editAiPrompt)"
            />
            <button
              v-else
              class="metadata-empty"
              :disabled="global.conf?.is_readonly"
              @click="editAt('reference-text', editAiPrompt)"
            >
              未填写 · 点击添加参考提示词
            </button>
          </MediaMetadataEditPopover>
        </section>
      </template>
      <template v-else-if="activeDetailsTab === 'generation'">
        <div v-if="promptLoading" class="prompt-empty" role="status">正在读取生成信息…</div>
        <div v-else-if="promptError" class="prompt-empty">
          读取失败 <button class="metadata-retry" @click="loadCurrentItemPrompt(true)">重试</button>
        </div>
        <div v-else class="generation-sheet">
          <p v-if="!hasGenerationContent" class="generation-empty">暂无生成信息</p>
          <section v-if="modelResources.length" class="generation-section generation-resources">
            <div class="generation-heading">
              <span>使用资源</span
              ><MediaMetadataEditPopover
                v-if="canEditInline"
                :session="session"
                kind="generation"
                :open="inlineField === '__resource' && editAnchor === 'resource-heading'"
                @dismiss="closeEdit"
                ><button
                  :disabled="!!inlineField"
                  aria-label="添加资源"
                  title="添加资源"
                  @click="editAt('resource-heading', () => beginInline('__resource'))"
                >
                  <PlusOutlined />
                </button>
              </MediaMetadataEditPopover>
            </div>
            <div
              v-for="(resource, index) in visibleResources"
              :key="index"
              class="generation-resource"
            >
              <div class="generation-resource-main">
                <strong :title="resource.name">{{ resource.name }}</strong
                ><span class="generation-resource-kind">{{
                  generationResourceLabel(resource.type)
                }}</span
                ><span v-if="resource.weight != null" class="generation-resource-weight">{{
                  resource.weight
                }}</span>
              </div>
              <details v-if="resource.hash" class="generation-resource-hash">
                <summary>哈希</summary>
                <code>{{ resource.hash }}</code>
              </details>
            </div>
            <button
              v-if="modelResources.length > 3"
              class="generation-expand"
              @click="resourcesExpanded = !resourcesExpanded"
            >
              {{ resourcesExpanded ? '收起资源' : `展开其余 ${modelResources.length - 3} 项` }}
            </button>
          </section>
          <section
            v-for="prompt in visiblePrompts"
            :key="prompt.key"
            class="generation-section generation-prompt"
          >
            <div class="generation-heading">
              <span :title="generationFieldTooltip(prompt.key)">{{
                generationFieldLabel(prompt.key)
              }}</span>
              <div class="generation-heading-actions">
                <button
                  v-if="geninfoStruct[prompt.key]"
                  :title="`复制${prompt.label}`"
                  :aria-label="`复制${prompt.label}`"
                  @click="copy2clipboardI18n(String(geninfoStruct[prompt.key] ?? ''))"
                >
                  <CopyOutlined />
                </button>
              </div>
            </div>
            <MediaMetadataEditPopover
              :session="session"
              kind="generation"
              :open="inlineField === prompt.key && editAnchor === prompt.key"
              @dismiss="closeEdit"
              ><GenerationPromptText
                :text="String(geninfoStruct[prompt.key] ?? '')"
                :label="prompt.label"
                :disabled="!canEditInline || !!inlineField"
                @edit="editAt(prompt.key, () => beginInline(prompt.key))"
              />
            </MediaMetadataEditPopover>
          </section>
          <section v-if="primaryParams.length" class="generation-section generation-parameters">
            <div class="generation-heading"><span>生成参数</span></div>
            <div class="generation-chips">
              <MediaMetadataEditPopover
                v-for="entry in primaryParams"
                :key="entry.key"
                :session="session"
                kind="generation"
                :open="inlineField === entry.key && editAnchor === entry.key"
                @dismiss="closeEdit"
                ><button
                  class="generation-chip"
                  :disabled="!canEditInline || !!inlineField"
                  :aria-label="`编辑${entry.key}`"
                  @click="editAt(entry.key, () => beginInline(entry.key))"
                >
                  <span :title="generationFieldTooltip(entry.key)">{{
                    generationFieldLabel(entry.key)
                  }}</span
                  ><strong>{{ entry.value }}</strong>
                </button>
              </MediaMetadataEditPopover>
            </div>
          </section>
          <div
            v-if="comfyWorkflow"
            class="generation-workflow"
            :title="`ComfyUI 工作流 · ${comfyWorkflow.nodeCount} 个节点`"
          >
            <span>Comfyui·{{ comfyWorkflow.nodeCount }}</span>
            <button
              aria-label="复制 ComfyUI 工作流"
              title="复制工作流 JSON"
              @click="copy2clipboardI18n(comfyWorkflow.json)"
            >
              <CopyOutlined />
            </button>
          </div>
        </div>
      </template>
      <template v-else>
        <section class="panel-section">
          <div class="section-title">文件信息</div>
          <dl class="file-metadata">
            <div v-for="entry in fileDetails" :key="entry.label">
              <dt>{{ entry.label }}</dt>
              <dd>{{ entry.value }}</dd>
            </div>
          </dl>
        </section>
        <section class="panel-section">
          <AudioMetadataPanel
            v-if="currentItem?.type === 'audio'"
            :key="currentItem.id"
            :file="currentItem.originalFile"
            :metadata="audioMetadata"
            :loading="audioLoading"
            :error="audioError"
            :before-save="beforeAudioSave"
            @reload="emit('reloadAudio')"
            @updated="emit('audioUpdated', $event)"
            @editing="emit('audioEditing', $event)"
            @settled="emit('audioSettled')"
          />
          <template v-else>
            <div class="section-title">文件元数据</div>
            <p v-if="metadataLoading" class="prompt-empty">正在读取元数据…</p>
            <p v-else-if="metadataError" class="prompt-empty">
              元数据读取失败
              <button class="metadata-retry" @click="loadCurrentItemMetadata(true)">重试</button>
            </p>
            <dl v-else-if="exifDetails.length" class="file-metadata">
              <div v-for="entry in exifDetails" :key="entry.label">
                <dt>{{ entry.label }}</dt>
                <dd>{{ entry.value }}</dd>
              </div>
            </dl>
            <p v-else class="prompt-empty">文件没有可读取的元数据</p>
          </template>
        </section>
      </template>
    </div>
    <p v-if="aiError && !descriptionEditing && !aiPromptEditing" class="ai-error" role="alert">
      {{ aiError }}
    </p>
    <section class="persistent-tags" aria-label="标签">
      <div class="section-title"><TagsOutlined /><span>标签</span></div>
      <div class="tags-content">
        <button
          v-for="tag in global.conf?.all_custom_tags || []"
          :key="tag.id"
          :disabled="global.conf?.is_readonly"
          :aria-pressed="isTagSelected(tag.id)"
          @click="onTagClick(tag.id)"
          :style="{
            ...tagBaseStyle,
            background: isTagSelected(tag.id) ? tagStore.getColor(tag) : 'transparent',
            color: isTagSelected(tag.id) ? 'white' : tagStore.getColor(tag),
            border: `1px solid ${tagStore.getColor(tag)}`
          }"
        >
          {{ tagLabel(tag) }}
        </button>
      </div>
      <p v-if="!global.conf?.all_custom_tags?.length" class="prompt-empty">
        可在设置的标签配置中添加标签
      </p>
      <div v-else-if="currentItem?.type === 'image'" class="ai-tags">
        <button :disabled="!!aiLoadingTask" @click="generateAiSuggestion('tags')">
          {{ aiLoadingTask === 'tags' ? '分析图片中…' : 'AI 推荐已有标签' }}
        </button>
        <div v-if="aiTagSuggestions.length" class="ai-tag-suggestions">
          <button
            v-for="name in aiTagSuggestions"
            :key="name"
            :disabled="
              global.conf?.is_readonly ||
              !!global.conf?.all_custom_tags.find(
                (tag) => tag.name === name && isTagSelected(tag.id)
              )
            "
            @click="applyAiTag(name)"
          >
            + {{ suggestedTagLabel(name) }}
          </button>
        </div>
      </div>
    </section>
  </aside>
</template>
