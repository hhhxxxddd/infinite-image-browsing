
import { ExtraPathType, addExtraPath, aliasExtraPath, removeExtraPath, updateImageData } from '@/api/db'
import { globalEvents } from '@/util'
import { Input, Modal, message, Button } from 'ant-design-vue'
import { open } from '@tauri-apps/plugin-dialog'
import { checkPathExists } from '@/api'
import { h, ref } from 'vue'
import { t } from '@/i18n'
import { useGlobalStore } from '@/store/useGlobalStore'
import { isTauri } from '@/util/env'



export const addToExtraPath = async (initType: ExtraPathType, initPath?: string) => {
  const g = useGlobalStore()
  const path = ref(initPath ?? '')
  const chooseFolder = async () => {
    const result = await open({directory:true, defaultPath:initPath})
    if(typeof result === 'string') path.value=result
  }
  Modal.confirm({
    title: '添加媒体文件夹', width: 620,
    okText: '添加并扫描', cancelText: '取消',
    content: () => h('div', { style:'padding-top:16px' }, [
      h('p', {style:'color:var(--zp-secondary)'}, '选择图片或视频所在的文件夹。文件保留在原位置，不会复制或上传。'),
      h('label', {for:'library-folder-path',style:'display:block;margin-bottom:8px;font-weight:600'}, '文件夹路径'),
      h(Input, {id:'library-folder-path',value:path.value,placeholder:g.conf?.is_win ? '例如 E:\\ComfyUI\\output' : '例如 /mnt/e/ComfyUI/output', 'onUpdate:value':(value:string) => path.value=value}),
      h('p', {style:'font-size:12px;color:var(--zp-secondary);margin-top:8px'}, g.conf?.is_win ? '当前文件服务运行于 Windows，请使用盘符路径或选择文件夹。' : '当前文件服务运行于 Linux。WSL 访问 Windows 磁盘时可使用 /mnt/e/ 等挂载路径。'),
      isTauri ? h(Button,{onClick:chooseFolder,style:'margin-top:12px'},'选择文件夹…') : null,

    ]),
    async onOk() {
      const selected=path.value.trim()
      if(!selected) {message.error(t('pathIsEmpty')); throw new Error('pathIsEmpty')}
      const found=await checkPathExists([selected])
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
