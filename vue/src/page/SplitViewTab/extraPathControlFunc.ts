
import { ExtraPathType, addExtraPath, aliasExtraPath, removeExtraPath, updateImageData } from '@/api/db'
import { globalEvents } from '@/util'
import { Input, Modal, message, Button } from 'ant-design-vue'
import { open } from '@tauri-apps/plugin-dialog'
import { checkPathIsDirectory, chooseLocalDirectory } from '@/api'
import { h, ref } from 'vue'
import { t } from '@/i18n'
import { useGlobalStore } from '@/store/useGlobalStore'
import { isTauri } from '@/util/env'



export const addToExtraPath = async (initType: ExtraPathType, initPath?: string) => {
  const g = useGlobalStore()
  const path = ref(initPath ?? '')
  const choosing = ref(false)
  const chooseFolder = async () => {
    if (choosing.value) return
    choosing.value = true
    try {
      const result = isTauri
        ? await open({ directory: true, defaultPath: path.value || undefined })
        : await chooseLocalDirectory()
      if (typeof result === 'string') path.value = result
    } catch {
      if (isTauri) message.error('无法打开文件夹选择器，请手动输入路径')
    } finally {
      choosing.value = false
    }
  }
  Modal.confirm({
    title: '添加媒体文件夹', width: 620,
    okText: '添加并扫描', cancelText: '取消',
    content: () => h('div', { style:'padding-top:16px' }, [
      h('p', {style:'color:var(--zp-secondary)'}, '选择图片或视频所在的文件夹。文件保留在原位置，不会复制或上传。'),
      h('label', {for:'library-folder-path',style:'display:block;margin-bottom:8px;font-weight:600'}, '文件夹路径'),
      h('div', { style:'display:flex;gap:8px;align-items:center' }, [
        h(Input, {id:'library-folder-path',value:path.value,placeholder:g.conf?.is_win ? '例如 E:\\ComfyUI\\output' : '选择文件夹或填写绝对路径',style:'flex:1;min-width:0', 'onUpdate:value':(value:string) => path.value=value}),
        h(Button, {onClick:chooseFolder,loading:choosing.value,style:'flex-shrink:0'}, {default:() => '浏览文件夹…'}),
      ]),
      h('p', {style:'font-size:12px;color:var(--zp-secondary);margin-top:8px'}, g.conf?.is_win ? '请选择这台电脑上的文件夹，或输入 Windows 盘符路径。' : '请输入运行文件服务的机器上的绝对目录路径。'),

    ]),
    async onOk() {
      const selected=path.value.trim()
      if(!selected) {message.error(t('pathIsEmpty')); throw new Error('pathIsEmpty')}
      const found=await checkPathIsDirectory([selected])
      if(!found[selected]) {message.error(t('pathDoesNotExist')); throw new Error('pathDoesNotExist')}
      await addExtraPath({types:[initType],path:selected})
      try { await updateImageData() }
      catch {
        globalEvents.emit('updateGlobalSetting')
        message.warning('文件夹已添加，但扫描未完成，请在媒体库中点击“扫描新增文件”重试')
        return
      }
      globalEvents.emit('searchIndexExpired')
      globalEvents.emit('updateGlobalSetting')
      message.success('文件夹已添加，媒体扫描完成')
    },
  })
}

export const addDroppedFolders = async (paths: string[]) => {
  const g = useGlobalStore()
  if (g.conf?.is_readonly || !paths.length) return
  const normalize = (path: string) => g.conf?.is_win ? path.replace(/[\\/]+$/, '').toLocaleLowerCase() : path.replace(/\/+$/, '')
  const registered = new Set((g.conf?.extra_paths ?? []).filter(folder => folder.types.includes('walk')).map(folder => normalize(folder.path)))
  const candidates = [...new Map(paths.map(path => [normalize(path), path])).values()]
    .filter(path => !registered.has(normalize(path)))
  if (!candidates.length) { message.info('这些文件夹已在媒体库中'); return }
  const directory = await checkPathIsDirectory(candidates)
  const valid = candidates.filter(path => directory[path])
  if (valid.length !== candidates.length) message.warning('已跳过文件和无法读取的路径，只能添加文件夹')
  if (!valid.length) return
  Modal.confirm({
    title: `添加 ${valid.length} 个文件夹？`,
    width: 620,
    okText: '添加并扫描', cancelText: '取消',
    content: () => h('div', [
      h('p', '文件保留在原位置，不会复制或上传。'),
      h('ul', {style:'max-height:240px;overflow:auto;word-break:break-all;padding-left:22px'}, valid.map(path => h('li', {key:path}, path)))
    ]),
    async onOk() {
      for (const path of valid) await addExtraPath({types:['walk'], path})
      globalEvents.emit('updateGlobalSetting')
      try { await updateImageData() }
      catch {
        message.warning('文件夹已添加，但扫描未完成，请在媒体库中点击“扫描新增文件”重试')
        return
      }
      globalEvents.emit('searchIndexExpired')
      globalEvents.emit('updateGlobalSetting')
      message.success(`已添加并扫描 ${valid.length} 个文件夹`)
    }
  })
}

export const onRemoveExtraPathClick = (path: string, type: ExtraPathType | ExtraPathType[]) => {
  Modal.confirm({
    title: '从媒体库移除此入口？',
    content: '仅移除浏览入口，不会删除磁盘上的文件。',
    okText: '移除入口', cancelText: '取消',
    closable: true,
    async onOk () {
      await removeExtraPath({ types: Array.isArray(type) ? type : [type], path })
      message.success(t('removeCompleted'))
      globalEvents.emit('searchIndexExpired')
      globalEvents.emit('updateGlobalSetting')
    }
  })
}

export const onAliasExtraPathClick = (path: string) => {
  const alias = ref(useGlobalStore().conf?.extra_paths.find(folder => folder.path === path)?.alias ?? '')
  Modal.confirm({
    title: '重命名显示名称',
    okText: '保存', cancelText: '取消',
    content: () => {
      return h('div', [
        h('div', {
          style: {
            'word-break': 'break-all',
            'margin-bottom': '4px'
          }
        }, '文件夹：' + path),
        h(Input, {
          value: alias.value,
          'onUpdate:value': (v: string) => (alias.value = v)
        })]
      )
    },
    async onOk () {
      await aliasExtraPath({ alias: alias.value, path })
      message.success(t('addAliasCompleted'))
      globalEvents.emit('updateGlobalSetting')
    }
  })
}
