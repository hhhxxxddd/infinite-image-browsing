<script setup lang="ts">
import { toRefs } from 'vue'
import type { UnwrapNestedRefs } from 'vue'
import type { usePreviewMetadata } from '../composables/usePreviewMetadata'
import type { MediaPreviewItem } from '../model/useMediaPreviewStore'
import { useApplicationStore } from '@/features/application/public'
import { useTagStore } from '@/features/media-library/public'
import { copy2clipboardI18n } from '@/shared/lib/clipboard'
import { tagLabel } from '@/features/media-library/public'
import { DEFAULT_IMAGE_PROMPT_EN, DEFAULT_IMAGE_PROMPT_ZH } from '@/features/ai-workflows/public'
import {
  generationParameterFields,
  generationNumberOptions,
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
}>()
const activeDetailsTab = defineModel<'description' | 'generation' | 'metadata'>('activeTab', {
  required: true
})
const emit = defineEmits<{ toggleDetails: []; editMetadata: [] }>()
const global = useApplicationStore()
const tagStore = useTagStore()
const {
  promptLoading,
  promptError,
  imageDescription,
  descriptionDraft,
  descriptionLoading,
  descriptionSaving,
  descriptionEditing,
  descriptionAvailable,
  descriptionError,
  aiDescriptionLength,
  aiDescriptionOpen,
  aiDescriptionTemplate,
  aiPromptDraft,
  aiPromptSaved,
  aiPromptEditing,
  aiPromptOpen,
  aiPromptLength,
  inlineField,
  inlineDraft,
  inlineSaving,
  inlineError,
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
  inlineParameter,
  hasGenerationContent,
  canEditInline,
  loadCurrentItemPrompt,
  loadCurrentItemDescription,
  loadCurrentItemMetadata,
  editDescription,
  saveDescription,
  beginInline,
  saveInline,
  confirmAiPrompt,
  confirmAiDescription,
  generateAiSuggestion,
  editAiPrompt,
  cancelAiPrompt,
  saveAiPrompt,
  applyAiTag,
  suggestedTagLabel,
  isWorkspaceArtifact
} = toRefs(props.session)
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
        :aria-selected="activeDetailsTab === 'description'"
        :class="{ active: activeDetailsTab === 'description' }"
        @click="activeDetailsTab = 'description'"
      >
        描述
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeDetailsTab === 'generation'"
        :class="{ active: activeDetailsTab === 'generation' }"
        @click="activeDetailsTab = 'generation'"
      >
        生成信息
      </button>
      <button
        type="button"
        role="tab"
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
        v-model:open="addGenerationFieldOpen"
        trigger="click"
        placement="bottomLeft"
        :z-index="1010"
      >
        <template #content
          ><div
            class="generation-add-menu"
            @keydown.stop
            @keydown.esc="addGenerationFieldOpen = false"
            @wheel.stop
          >
            <button
              :disabled="!canEditInline || !!inlineField"
              title="使用资源"
              aria-label="使用资源"
              @click="beginInline('__resource')"
            >
              使用资源…</button
            ><button
              v-for="field in missingGenerationFields"
              :key="field.key"
              :title="generationFieldTooltip(field.key)"
              :aria-label="generationFieldTooltip(field.key)"
              @click="beginInline(field.key)"
            >
              {{ generationFieldLabel(field.key) }}
            </button>
          </div></template
        >
        <button
          class="generation-add-trigger"
          :disabled="!canEditInline || !!inlineField"
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
      <button
        :disabled="
          global.conf?.is_readonly || promptLoading || promptError || isAnimating || !!inlineField
        "
        aria-label="编辑原始生成信息"
        title="编辑原始生成信息"
        @click="emit('editMetadata')"
      >
        <EditOutlined />
      </button>
    </div>
    <div class="panel-body" role="tabpanel">
      <template v-if="activeDetailsTab === 'description'">
        <section class="panel-section description-section">
          <div class="section-title">
            <span>媒体描述</span>
            <div v-if="descriptionAvailable" class="generation-heading-actions">
              <button
                v-if="imageDescription && !descriptionEditing"
                :disabled="descriptionLoading || descriptionError"
                aria-label="复制媒体描述"
                title="复制媒体描述"
                @click="copy2clipboardI18n(imageDescription)"
              >
                <CopyOutlined />
              </button>
              <button
                v-if="!global.conf?.is_readonly && !descriptionEditing"
                :disabled="descriptionLoading || descriptionError"
                aria-label="编辑媒体描述"
                title="编辑媒体描述"
                @click="editDescription"
              >
                <EditOutlined />
              </button>
              <a-popover
                v-if="currentItem?.type === 'image' && !global.conf?.is_readonly"
                v-model:open="aiDescriptionOpen"
                trigger="click"
                placement="bottomRight"
                :z-index="1010"
              >
                <template #content>
                  <div
                    class="description-ai-confirm"
                    @keydown.stop
                    @keydown.esc="aiDescriptionOpen = false"
                    @wheel.stop
                  >
                    <label for="description-ai-prompt">提示词</label>
                    <a-textarea
                      id="description-ai-prompt"
                      v-model:value="aiDescriptionTemplate"
                      :rows="5"
                      :maxlength="2000"
                    />
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
                      <a-button size="small" @click="aiDescriptionOpen = false">取消</a-button
                      ><a-button
                        size="small"
                        type="primary"
                        :disabled="
                          !aiDescriptionTemplate.trim() || !!aiLoadingTask || descriptionSaving
                        "
                        @click="confirmAiDescription"
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
          <template v-else-if="descriptionEditing">
            <textarea
              v-model="descriptionDraft"
              class="description-input"
              maxlength="5000"
              rows="4"
              aria-label="媒体描述编辑区"
              :disabled="aiLoadingTask === 'description' || descriptionSaving"
              :placeholder="
                isWorkspaceArtifact
                  ? '写下媒体内容或备注；同步到媒体库后可用于搜索'
                  : '写下媒体内容或备注，保存后可通过文字搜索'
              "
            />
            <div class="description-actions">
              <button :disabled="descriptionSaving" @click="descriptionEditing = false">取消</button
              ><button
                :disabled="descriptionSaving || aiLoadingTask === 'description'"
                @click="saveDescription"
              >
                {{ descriptionSaving ? '保存中…' : '保存描述' }}
              </button>
            </div>
          </template>
          <GenerationPromptText
            v-else-if="imageDescription"
            :text="imageDescription"
            label="媒体描述"
            :disabled="!!global.conf?.is_readonly || descriptionSaving"
            @edit="editDescription"
          />
          <button
            v-else
            class="metadata-empty"
            :disabled="global.conf?.is_readonly"
            @click="editDescription"
          >
            未填写 · 点击添加描述
          </button>
        </section>
        <section v-if="currentItem?.type === 'image'" class="panel-section ai-prompt-section">
          <div class="section-title">
            <span>AI 参考提示词</span>
            <div class="generation-heading-actions">
              <button
                v-if="aiPromptSaved && !aiPromptEditing"
                aria-label="复制参考提示词"
                title="复制参考提示词"
                @click="copy2clipboardI18n(aiPromptSaved)"
              >
                <CopyOutlined />
              </button>
              <button
                v-if="aiPromptSaved && !aiPromptEditing && !global.conf?.is_readonly"
                :disabled="!!aiLoadingTask || aiSavingPrompt"
                aria-label="编辑参考提示词"
                title="编辑参考提示词"
                @click="editAiPrompt"
              >
                <EditOutlined />
              </button>
              <a-popover
                v-if="currentItem?.type === 'image'"
                v-model:open="aiPromptOpen"
                trigger="click"
                placement="bottomRight"
                :z-index="1010"
              >
                <template #content>
                  <div
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
                    <label for="ai-prompt-template">提示词</label
                    ><a-textarea
                      id="ai-prompt-template"
                      v-model:value="aiPromptTemplate"
                      :rows="5"
                      :maxlength="2000"
                    />
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
                      <a-button size="small" @click="aiPromptOpen = false">取消</a-button
                      ><a-button
                        size="small"
                        type="primary"
                        :disabled="!aiPromptTemplate.trim() || !!aiLoadingTask || aiSavingPrompt"
                        @click="confirmAiPrompt"
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
          <p v-if="aiLoadingTask === 'prompt'" class="prompt-empty" role="status">
            正在生成参考提示词…
          </p>
          <template v-if="aiPromptEditing">
            <textarea
              v-model="aiPromptDraft"
              class="description-input"
              :disabled="aiSavingPrompt || aiLoadingTask === 'prompt' || global.conf?.is_readonly"
              maxlength="5000"
              rows="5"
              aria-label="编辑参考提示词"
              placeholder="AI 生成后可编辑"
            />
            <div class="description-actions">
              <button
                :disabled="aiSavingPrompt || aiLoadingTask === 'prompt'"
                @click="cancelAiPrompt"
              >
                取消
              </button>
              <button
                :disabled="
                  global.conf?.is_readonly ||
                  aiSavingPrompt ||
                  aiLoadingTask === 'prompt' ||
                  aiPromptDraft === aiPromptSaved
                "
                @click="saveAiPrompt"
              >
                {{ aiSavingPrompt ? '保存中…' : '保存参考提示词' }}
              </button>
            </div>
          </template>
          <GenerationPromptText
            v-else-if="aiPromptSaved"
            :text="aiPromptSaved"
            label="参考提示词"
            :disabled="!!global.conf?.is_readonly || !!aiLoadingTask || aiSavingPrompt"
            @edit="editAiPrompt"
          />
          <p v-else-if="aiLoadingTask !== 'prompt'" class="reference-prompt-hint">
            根据画面反推，独立保存为参考提示词。
          </p>
        </section>
      </template>
      <template v-else-if="activeDetailsTab === 'generation'">
        <div v-if="promptLoading" class="prompt-empty" role="status">正在读取生成信息…</div>
        <div v-else-if="promptError" class="prompt-empty">
          读取失败 <button class="metadata-retry" @click="loadCurrentItemPrompt(true)">重试</button>
        </div>
        <div v-else class="generation-sheet">
          <p v-if="!hasGenerationContent && !inlineField" class="generation-empty">暂无生成信息</p>
          <section
            v-if="modelResources.length || inlineField === '__resource'"
            class="generation-section generation-resources"
          >
            <div class="generation-heading">
              <span>使用资源</span
              ><button
                v-if="canEditInline"
                :disabled="!!inlineField"
                aria-label="添加资源"
                title="添加资源"
                @click="beginInline('__resource')"
              >
                <PlusOutlined />
              </button>
            </div>
            <GenerationResourceForm
              v-if="inlineField === '__resource'"
              :saving="inlineSaving"
              :error="inlineError"
              @save="saveInline"
              @cancel="inlineField = ''"
            />
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
            <MetadataInlineEditor
              v-if="inlineField === prompt.key"
              v-model="inlineDraft"
              :label="generationFieldLabel(prompt.key)"
              multiline
              :saving="inlineSaving"
              :error="inlineError"
              @save="saveInline"
              @cancel="inlineField = ''"
            />
            <GenerationPromptText
              v-else
              :text="String(geninfoStruct[prompt.key] ?? '')"
              :label="prompt.label"
              :disabled="!canEditInline || !!inlineField"
              @edit="beginInline(prompt.key)"
            />
          </section>
          <section
            v-if="primaryParams.length || inlineParameter"
            class="generation-section generation-parameters"
          >
            <div class="generation-heading"><span>生成参数</span></div>
            <div class="generation-chips">
              <button
                v-for="entry in primaryParams"
                :key="entry.key"
                class="generation-chip"
                :class="{ 'is-editing': inlineField === entry.key }"
                :disabled="!canEditInline || !!inlineField"
                :aria-label="`编辑${entry.key}`"
                @click="beginInline(entry.key)"
              >
                <span :title="generationFieldTooltip(entry.key)">{{
                  generationFieldLabel(entry.key)
                }}</span
                ><strong>{{ entry.value }}</strong>
              </button>
            </div>
            <div v-if="inlineParameter" class="generation-parameter-editor">
              <label :title="generationFieldTooltip(inlineField)">{{
                generationFieldLabel(inlineField)
              }}</label
              ><MetadataInlineEditor
                v-model="inlineDraft"
                :label="generationFieldLabel(inlineField)"
                :size="inlineField === 'Size'"
                :numeric="generationNumberOptions(inlineField)"
                :placeholder="
                  generationParameterFields.find((field) => field.key === inlineField)?.placeholder
                "
                :saving="inlineSaving"
                :error="inlineError"
                @save="saveInline"
                @cancel="inlineField = ''"
              />
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
        </section>
      </template>
    </div>
    <p v-if="aiError" class="ai-error" role="alert">{{ aiError }}</p>
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
