<script setup lang="ts">
import type { Tag } from '@/api/db'
import type { FileNodeInfo } from '@/api/files'
import type { MenuInfo } from 'ant-design-vue/lib/menu/src/interface'
import { isImageFile } from '@/util'
import { useGlobalStore } from '@/store/useGlobalStore'
import { computed } from 'vue'
import TagMenuItems from './TagMenuItems.vue'
const global = useGlobalStore()
const props = defineProps<{
  file: FileNodeInfo
  idx: number,
  selectedTag: Tag[],
  isSelectedMutilFiles?: boolean
}>()
const emit = defineEmits<{
  (type: 'contextMenuClick', e: MenuInfo, file: FileNodeInfo, idx: number): void
}>()

const tags = computed(() => {
  return (global.conf?.all_custom_tags ?? []).reduce((p, c) => {
    return [...p, { ...c, selected: !!props.selectedTag.find((v) => v.id === c.id) }]
  }, [] as (Tag & { selected: boolean })[])
})
</script>
<template>
  <a-menu @click="emit('contextMenuClick', $event, file, idx)">
    <template v-if="file.type === 'dir'">
      <a-menu-item key="openInNewTab">打开文件夹</a-menu-item>
      <a-menu-item key="openWithWalkMode">查看全部内容</a-menu-item>
    </template>
    <template v-else>
      <a-menu-item v-if="!isSelectedMutilFiles && isImageFile(file.name)" key="similarImages">查找相似图片</a-menu-item>
      <template v-if="isSelectedMutilFiles">
        <a-sub-menu key="batch-add-tag" title="添加标签">
          <TagMenuItems :tags="tags" key-prefix="batch-add-tag-" />
        </a-sub-menu>
        <a-sub-menu key="batch-remove-tag" title="移除标签">
          <TagMenuItems :tags="tags" key-prefix="batch-remove-tag-" />
        </a-sub-menu>
      </template>
      <a-sub-menu v-else key="toggle-tag" title="标签">
        <TagMenuItems :tags="tags" key-prefix="toggle-tag-" show-selection />
      </a-sub-menu>
      <a-menu-item v-if="!isSelectedMutilFiles" key="openFileLocationInNewTab">打开所在文件夹</a-menu-item>
      <a-menu-item v-if="!isSelectedMutilFiles" key="rename" :disabled="global.conf?.is_readonly">重命名</a-menu-item>
      <a-menu-item key="download">下载</a-menu-item>
      <a-menu-item v-if="!isSelectedMutilFiles" key="copyFilePath">复制文件路径</a-menu-item>
    </template>
    <a-menu-divider />
    <a-menu-item key="deleteFiles" danger :disabled="global.conf?.is_readonly">删除</a-menu-item>
  </a-menu>
</template>
