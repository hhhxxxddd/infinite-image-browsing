<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { FolderOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons-vue'
import { useApplicationStore } from '@/features/application/public'
import { getTargetFolderFiles, type FileNodeInfo } from '../api/files'
import { sameFolderPath } from '../../../shared/lib/folderScope'
import {
  scannedDirectoryRoots,
  isLibraryDirectory,
  libraryDirectoryBreadcrumbs
} from '../model/libraryDirectory'

const props = defineProps<{ initialPath?: string }>()
const emit = defineEmits<{ ready: [path: string] }>()
const global = useApplicationStore()
const roots = computed(() =>
  scannedDirectoryRoots(global.conf?.extra_paths ?? [], global.conf?.is_win)
)
const path = ref('')
const children = ref<FileNodeInfo[]>([])
const loading = ref(false)
const error = ref('')
const query = ref('')
const filteredChildren = computed(() =>
  children.value.filter((child) =>
    child.name.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())
  )
)
const crumbs = computed(() =>
  libraryDirectoryBreadcrumbs(roots.value, path.value, global.conf?.is_win)
)
const label = (root: { path: string; alias?: string }) =>
  root.alias || root.path.split(/[\\/]/).filter(Boolean).pop() || root.path
let requestId = 0
onBeforeUnmount(() => requestId++)

async function browse(directory: string) {
  if (!isLibraryDirectory(directory, roots.value, global.conf?.is_win)) return
  const request = ++requestId
  path.value = directory
  children.value = []
  error.value = ''
  query.value = ''
  loading.value = true
  emit('ready', '')
  try {
    const result = await getTargetFolderFiles(directory, true)
    if (request !== requestId) return
    children.value = result.files
      .filter(
        (file) =>
          file.type === 'dir' && isLibraryDirectory(file.fullpath, roots.value, global.conf?.is_win)
      )
      .sort((a, b) => a.name.localeCompare(b.name))
    emit('ready', directory)
  } catch {
    if (request === requestId) error.value = '无法读取此目录，请选择其他目录或重试。'
  } finally {
    if (request === requestId) loading.value = false
  }
}

watch(
  roots,
  () => {
    if (isLibraryDirectory(path.value, roots.value, global.conf?.is_win)) return
    requestId++
    emit('ready', '')
    const initial =
      props.initialPath && isLibraryDirectory(props.initialPath, roots.value, global.conf?.is_win)
        ? props.initialPath
        : roots.value[0]?.path
    if (initial) void browse(initial)
    else {
      path.value = ''
      children.value = []
      loading.value = false
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="library-directory-browser">
    <nav class="directory-roots" aria-label="媒体库扫描目录">
      <button
        v-for="root in roots"
        :key="root.path"
        type="button"
        :title="root.path"
        :class="{ active: sameFolderPath(root.path, crumbs[0]?.path ?? '', global.conf?.is_win) }"
        @click="browse(root.path)"
      >
        <FolderOutlined /><span>{{ label(root) }}</span>
      </button>
    </nav>
    <section class="directory-contents">
      <div class="directory-location">
        <nav class="directory-crumbs" aria-label="当前目录位置">
          <template v-for="(crumb, index) in crumbs" :key="crumb.path">
            <RightOutlined v-if="index" />
            <button
              type="button"
              :title="crumb.path"
              :aria-current="index === crumbs.length - 1 ? 'location' : undefined"
              @click="browse(crumb.path)"
            >
              {{ crumb.name }}
            </button>
          </template>
        </nav>
        <button
          class="directory-refresh"
          type="button"
          aria-label="刷新目录"
          :disabled="!path || loading"
          @click="browse(path)"
        >
          <ReloadOutlined />
        </button>
      </div>
      <a-input
        v-model:value="query"
        placeholder="查找子目录"
        aria-label="查找子目录"
        allow-clear
        :disabled="loading"
      />
      <div class="directory-folders" :aria-busy="loading">
        <span v-if="loading" class="directory-empty" role="status">读取中…</span>
        <span v-else-if="error" class="directory-error" role="alert">{{ error }}</span>
        <template v-else>
          <button
            v-for="child in filteredChildren"
            :key="child.fullpath"
            class="directory-folder"
            type="button"
            :title="child.fullpath"
            @click="browse(child.fullpath)"
          >
            <FolderOutlined /><span>{{ child.name }}</span
            ><RightOutlined />
          </button>
          <span v-if="!filteredChildren.length" class="directory-empty">{{
            query ? '没有匹配的子目录' : '没有子目录'
          }}</span>
        </template>
      </div>
    </section>
    <div class="directory-selection" :title="path">
      <span>当前目录</span><strong>{{ path }}</strong>
    </div>
  </div>
</template>

<style scoped>
.library-directory-browser {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 12px;
  margin-top: 16px;
  color: var(--zp-primary);
}
.directory-roots {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 340px;
  overflow: auto;
  padding: 6px;
  border-radius: var(--ui-radius);
  background: var(--ui-surface-soft);
}
.directory-roots button,
.directory-folder,
.directory-crumbs button,
.directory-refresh {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.directory-roots button {
  padding: 10px 8px;
}
.directory-roots button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.directory-roots button .anticon,
.directory-folder > .anticon:first-child {
  color: var(--primary-color);
  flex: none;
}
.directory-roots button.active,
.directory-roots button:hover,
.directory-folder:hover {
  background: var(--ui-accent-soft);
}
.directory-roots button.active {
  color: var(--primary-color);
}
.directory-contents {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.directory-location {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 32px;
}
.directory-crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}
.directory-crumbs button {
  padding: 4px 6px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.directory-crumbs button[aria-current] {
  color: var(--primary-color);
}
.directory-crumbs > .anticon {
  font-size: 9px;
  color: var(--zp-secondary);
}
.directory-refresh {
  padding: 8px;
  flex: none;
}
.directory-refresh:disabled {
  opacity: 0.45;
  cursor: default;
}
.directory-folders {
  height: 252px;
  overflow: auto;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  padding: 6px;
}
.directory-folder {
  width: 100%;
  padding: 10px;
}
.directory-folder span:not(.anticon) {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.directory-folder > .anticon:last-child {
  font-size: 10px;
  color: var(--zp-secondary);
  flex: none;
}
.directory-empty,
.directory-error {
  display: block;
  padding: 24px 12px;
  font-size: 12px;
  color: var(--zp-secondary);
}
.directory-error {
  color: var(--ant-error-color, #ff4d4f);
}
.directory-selection {
  grid-column: 1 / -1;
  display: flex;
  gap: 10px;
  align-items: baseline;
  min-width: 0;
  padding-top: 4px;
  font-size: 12px;
}
.directory-selection > span {
  color: var(--zp-secondary);
  flex: none;
}
.directory-selection strong {
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
@media (max-width: 560px) {
  .library-directory-browser {
    grid-template-columns: minmax(0, 1fr);
  }
  .directory-roots {
    flex-direction: row;
    max-height: none;
  }
  .directory-roots button {
    flex: none;
  }
  .directory-folders {
    height: 220px;
  }
}
</style>
