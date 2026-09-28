<script setup lang="ts">
import { computed } from 'vue'
import {
  CustomerServiceOutlined as AudioOutlined,
  VideoCameraOutlined,
  PictureOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  SoundOutlined,
  FileTextOutlined
} from '@ant-design/icons-vue'
import {
  toImageThumbnailUrl,
  toVideoCoverUrl,
  type FileNodeInfo
} from '@/features/media-library/public'
import type { WorkspaceAsset } from '../model/workspaceModel'
import type { WorkspaceWork, ProductionDraft } from '../model/workspaceWorks'

const props = defineProps<{
  work: WorkspaceWork
  draft: ProductionDraft
  assets: WorkspaceAsset[]
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
}>()
defineEmits<{ preview: [asset: WorkspaceAsset]; addAssets: []; edit: [] }>()
const isVideo = computed(() => props.draft.kind === 'video')
const visual = computed(() => props.assets.find((asset) => asset.kind !== 'audio'))
const sounds = computed(() => props.assets.filter((asset) => asset.kind === 'audio'))
function thumbnail(asset: WorkspaceAsset) {
  const file = props.assetInfo[asset.path]
  return file && asset.kind !== 'audio'
    ? asset.kind === 'video'
      ? toVideoCoverUrl(file)
      : toImageThumbnailUrl(file, '720x420')
    : ''
}
const lanes = computed(() =>
  isVideo.value
    ? [
        {
          name: '画面',
          icon: VideoCameraOutlined,
          assets: props.assets.filter((asset) => asset.kind !== 'audio')
        },
        { name: '声音', icon: SoundOutlined, assets: sounds.value },
        { name: '字幕', icon: FileTextOutlined, assets: [] }
      ]
    : [
        { name: '音频', icon: AudioOutlined, assets: sounds.value },
        { name: '台词', icon: FileTextOutlined, assets: [] }
      ]
)
</script>

<template>
  <section class="media-creation" :aria-label="isVideo ? '视频制作布局' : '音频制作布局'">
    <header class="media-creation-heading">
      <div>
        <VideoCameraOutlined v-if="isVideo" /><AudioOutlined v-else /><strong>{{
          draft.name
        }}</strong
        ><span>剪辑布局预览</span>
      </div>
      <a-button disabled>导出{{ isVideo ? '视频' : '音频' }}</a-button>
    </header>
    <div class="media-edit-layout">
      <section class="media-source-panel">
        <header>
          <h3>
            工作区素材 <small>{{ assets.length }}</small>
          </h3>
          <button
            type="button"
            :disabled="readonly"
            aria-label="从媒体库加入素材"
            @click="$emit('addAssets')"
          >
            <PlusOutlined />
          </button>
        </header>
        <div v-if="assets.length" class="source-list">
          <button
            v-for="asset in assets"
            :key="asset.path"
            type="button"
            @click="$emit('preview', asset)"
          >
            <span class="source-thumb"
              ><img v-if="thumbnail(asset)" :src="thumbnail(asset)" alt="" /><AudioOutlined
                v-else-if="asset.kind === 'audio'" /><PictureOutlined v-else /></span
            ><span
              ><strong>{{ asset.name }}</strong
              ><small>{{
                { image: '图片', video: '视频', audio: '音频' }[asset.kind]
              }}</small></span
            ><PlayCircleOutlined />
          </button>
        </div>
        <div v-else class="sources-empty">
          <p>工作区还没有素材</p>
          <a-button :disabled="readonly" @click="$emit('addAssets')"
            ><PlusOutlined />加入素材</a-button
          >
        </div>
      </section>
      <div class="media-stage-column">
        <div v-if="isVideo" class="video-stage">
          <img v-if="visual && thumbnail(visual)" :src="thumbnail(visual)" alt="作品画面参考" />
          <div v-else class="stage-empty"><VideoCameraOutlined /><span>画面预览</span></div>
          <button v-if="visual" type="button" @click="$emit('preview', visual)">
            <PlayCircleOutlined />预览源文件
          </button>
        </div>
        <div v-else class="audio-stage">
          <div class="audio-stage-icon"><AudioOutlined /></div>
          <strong>{{ sounds[0]?.name ?? '声音作品' }}</strong
          ><span>{{ sounds.length ? `${sounds.length} 项音频素材` : '配音、音乐或声音片段' }}</span>
          <div class="wave-placeholder" aria-label="波形布局示意，尚未解析音频">
            <i
              v-for="index in 49"
              :key="index"
              :style="{ height: 10 + ((index * 17) % 43) + 'px' }"
            />
          </div>
          <small>波形区域示意 · 音频解析待接入</small
          ><a-button v-if="sounds[0]" @click="$emit('preview', sounds[0])"
            ><PlayCircleOutlined />试听源文件</a-button
          >
        </div>
        <div class="stage-caption">
          <span>{{ isVideo ? '画面与声音共用同一份剪辑草稿' : '音频草稿，专注声音制作' }}</span
          ><span>{{ isVideo ? '16:9' : '音轨视图' }}</span>
        </div>
      </div>
    </div>
    <section class="timeline-preview" aria-label="轨道布局预览">
      <header>
        <h3>轨道</h3>
        <span>剪裁、排序与时间定位待接入</span>
      </header>
      <div class="timeline-ruler" aria-hidden="true">
        <span>开始</span><i /><i /><i /><i /><span>结束</span>
      </div>
      <div v-for="lane in lanes" :key="lane.name" class="timeline-lane">
        <span class="lane-name"><component :is="lane.icon" />{{ lane.name }}</span>
        <div class="lane-content">
          <button
            v-for="asset in lane.assets"
            :key="asset.path"
            type="button"
            :class="asset.kind"
            @click="$emit('preview', asset)"
          >
            {{ asset.name }}</button
          ><span v-if="!lane.assets.length" class="lane-empty">{{
            lane.name === '字幕' || lane.name === '台词' ? '台词与字幕区域' : '尚未选择素材'
          }}</span>
        </div>
      </div>
    </section>
    <footer class="media-note">
      <div>
        <h3>草稿笔记</h3>
        <p>{{ draft.brief || '记录这份草稿的想法、台词或剪辑安排。' }}</p>
      </div>
      <a-button :disabled="readonly" @click="$emit('edit')">编辑笔记</a-button>
    </footer>
  </section>
</template>

<style scoped>
.media-creation {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.media-creation-heading,
.media-creation-heading > div,
header,
.media-note {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: space-between;
}
.media-creation-heading > div {
  justify-content: flex-start;
  flex-wrap: wrap;
}
.media-creation-heading span,
header > span {
  color: var(--ui-muted);
  font-size: 12px;
}
.media-creation-heading strong {
  font-size: 15px;
}
.media-edit-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 14px;
}
.media-source-panel,
.timeline-preview,
.media-note {
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  padding: 16px;
  min-width: 0;
}
h3 {
  font-size: 13px;
  margin: 0;
}
h3 small {
  font-weight: 400;
  color: var(--ui-muted);
  margin-left: 4px;
}
.media-source-panel header button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  cursor: pointer;
}
.source-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 340px;
  overflow: auto;
  margin-top: 12px;
}
.source-list button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  padding: 6px;
  border: 0;
  border-radius: 8px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.source-thumb {
  flex: none;
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 6px;
  background: var(--ui-hover);
  overflow: hidden;
  font-size: 20px;
  color: var(--ui-muted);
}
.source-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.source-list button > span:nth-child(2) {
  min-width: 0;
  flex: 1;
}
.source-list strong {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}
.source-list small {
  color: var(--ui-muted);
  font-size: 10px;
}
.source-list button > .anticon {
  color: var(--ui-muted);
}
.sources-empty {
  color: var(--ui-muted);
  text-align: center;
  padding: 40px 0;
  font-size: 12px;
}
.media-stage-column {
  min-width: 0;
}
.video-stage {
  position: relative;
  display: grid;
  place-items: center;
  background: #111820;
  width: 100%;
  height: clamp(240px, 38vh, 420px);
  overflow: hidden;
  border-radius: 12px;
}
.video-stage > img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  position: absolute;
}
.video-stage > button {
  position: absolute;
  bottom: 15px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid #ffffff25;
  border-radius: 8px;
  background: #111820c9;
  color: #fff;
  cursor: pointer;
}
.stage-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #8b9bad;
  font-size: 12px;
}
.stage-empty .anticon {
  font-size: 32px;
  opacity: 0.65;
}
.audio-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 310px;
  padding: 24px;
  border-radius: 12px;
  background:
    radial-gradient(
      at 50% 0,
      color-mix(in srgb, var(--primary-color) 12%, transparent),
      transparent 65%
    ),
    var(--ui-surface);
  border: 1px solid var(--ui-border);
  gap: 10px;
}
.audio-stage-icon {
  font-size: 28px;
  background: color-mix(in srgb, var(--primary-color) 10%, transparent);
  color: var(--primary-color);
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
}
.audio-stage strong {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.audio-stage > span,
.audio-stage small {
  color: var(--ui-muted);
  font-size: 12px;
}
.audio-stage small {
  font-size: 10px;
}
.wave-placeholder {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  max-width: 100%;
  overflow: hidden;
  margin-top: 6px;
}
.wave-placeholder i {
  width: 3px;
  flex: none;
  border-radius: 2px;
  background: var(--primary-color);
  opacity: 0.3;
}
.stage-caption {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 2px 0;
  color: var(--ui-muted);
  font-size: 11px;
}
.timeline-preview header {
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.timeline-ruler {
  height: 22px;
  margin-left: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  color: var(--ui-muted);
}
.timeline-ruler i {
  height: 6px;
  border-left: 1px solid var(--ui-border);
}
.timeline-lane {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}
.lane-name {
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 58px;
  flex: none;
  color: var(--ui-muted);
}
.lane-content {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px;
  border-radius: 7px;
  background: var(--ui-surface-soft);
  overflow: auto;
}
.lane-content button {
  flex: none;
  min-width: 140px;
  max-width: 220px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--primary-color) 25%, var(--ui-border));
  border-radius: 5px;
  background: color-mix(in srgb, var(--primary-color) 12%, var(--ui-surface));
  color: var(--ui-text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lane-content button.audio {
  background: color-mix(in srgb, #448c7b 12%, var(--ui-surface));
  border-color: color-mix(in srgb, #448c7b 25%, var(--ui-border));
}
.lane-empty {
  color: var(--ui-muted);
  font-size: 11px;
  opacity: 0.7;
  padding-left: 10px;
}
.media-note {
  align-items: flex-start;
}
.media-note > div {
  min-width: 0;
  flex: 1;
}
.media-note p {
  margin: 7px 0 0;
  font-size: 12px;
  color: var(--ui-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
@media (max-width: 850px) {
  .media-edit-layout {
    grid-template-columns: 1fr;
  }
  .source-list {
    flex-direction: row;
    max-height: 100px;
  }
  .source-list button {
    width: 210px;
    flex: none;
  }
  .sources-empty {
    padding: 10px 0;
  }
}
</style>
