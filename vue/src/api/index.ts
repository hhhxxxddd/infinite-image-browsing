import { Modal, message } from 'ant-design-vue'
import axios, { AxiosInstance, isAxiosError } from 'axios'
import { t } from '@/i18n'
import type { ExtraPathModel, Tag } from './db'
import cookie from 'js-cookie'
import { delay } from 'vue3-ts-util'
import { computed, h, ref } from 'vue'
import sjcl from 'sjcl'
import { tauriConf } from '@/util/tauriAppConf'
import { Dict } from '@/util'
import { FileNodeInfo } from './files'

export const apiBase = computed(() =>
  tauriConf.value
    ? `http://127.0.0.1:${tauriConf.value.port}/infinite_image_browsing`
    : '/infinite_image_browsing'
)

const sha256 = (data: string) => {
  const hash = sjcl.hash.sha256.hash(data)
  return sjcl.codec.hex.fromBits(hash)
}

// Prevent multiple stacked auth prompts when several requests return 401 at the same time
let pendingServerKeyPrompt: Promise<string> | null = null
let isReloadingAfterAuth = false

const promptServerKeyOnce = async (): Promise<string> => {
  if (pendingServerKeyPrompt) return pendingServerKeyPrompt

  pendingServerKeyPrompt = new Promise<string>((resolve) => {
    const key = ref('')

    const finish = (v: string) => {
      pendingServerKeyPrompt = null
      resolve(v)
    }

    Modal.confirm({
      title: t('serverKeyRequired'),
      content: () =>
        h('input', {
          class: 'ant-input',
          type: 'password',
          value: key.value,
          onInput: (e: any) => (key.value = e.target.value),
          autocomplete: 'current-password',
          name: 'password',
          autocapitalize: 'off',
          spellcheck: false,
          style: 'width: 100%;'
        }),
      onOk () {
        finish(key.value)
      },
      onCancel () {
        finish('')
      }
    })
  })

  return pendingServerKeyPrompt
}

const addInterceptor = (axiosInst: AxiosInstance) => {
  axiosInst.interceptors.response.use(
    (resp) => resp,
    async (err) => {
      if (isAxiosError(err)) {
        if (err.response?.status === 401 && err.response?.data?.detail?.type === 'secret_verification_failed') {
          const key = await promptServerKeyOnce()
          if (!key) {
            // user cancelled; leave the request rejected as-is
            throw err
          }

          cookie.set('IIB_S', sha256(key + '_ciallo'))

          if (!isReloadingAfterAuth) {
            isReloadingAfterAuth = true
            await delay(100)
            location.reload()
          }

          // prevent any further error handling UI from showing while we reload
          return new Promise(() => {})
        }

        let errmsg = err.response?.data?.detail
        try {
          if (!errmsg) {
            errmsg = JSON.parse(await err.response?.data.text()).detail
          }
        } catch (e) {
          console.error(err.response, e)
        }
        errmsg ??= t('errorOccurred')
        message.error(errmsg)
        throw new Error(errmsg)
      }
      return err
    }
  )
}

export const axiosInst = computed(() => {
  const axiosInst = axios.create({
    baseURL: apiBase.value
  })
  addInterceptor(axiosInst)
  return axiosInst
})
export const greeting = async () => {
  const resp = await axiosInst.value.get('hello')
  return resp.data as string
}

export interface GlobalConf {
  all_custom_tags: Tag[]
  is_win: boolean
  cwd: string
  home: string
  working_dir: string
  archive: ArchiveSettings
  extra_paths: ExtraPathModel[]
  enable_access_control: boolean
  launch_mode: 'server'
  export_fe_fn: boolean
  app_fe_setting: Record<'global' | 'fullscreen_layout' | 'auto_tag_rules' | `workspace_snapshot_${string}`, any>
  is_readonly: boolean
}

export const getGlobalSetting = async () => {
  const resp = await axiosInst.value.get('/global_setting')
  return resp.data as GlobalConf
}

/**
 * 获取本机持久化的 global_setting（包含 app_fe_setting）。
 * 仅在确实需要使用后端 KV（GlobalSetting 表）做持久化时使用。
 */
export const getGlobalSettingRaw = async () => {
  const resp = await axiosInst.value.get('/global_setting')
  return resp.data as GlobalConf
}

export const getVersion = async () => {
  const resp = await axiosInst.value.get('/version')
  return resp.data as { hash?: string, tag?: string }
}

export const checkPathExists = async (paths: string[]) => {
  const resp = await axiosInst.value.post('/check_path_exists', { paths })
  return resp.data as Record<string, boolean>
}

export const checkPathIsDirectory = async (paths: string[]) => {
  const resp = await axiosInst.value.post('/check_path_is_directory', { paths })
  return resp.data as Record<string, boolean>
}

export const getImageGenerationInfo = async (path: string) => {
  return (await axiosInst.value.get(`/image_geninfo?path=${encodeURIComponent(path)}`))
    .data as string
}

export const updateExif = async (path: string, exif: string) => {
  const resp = await axiosInst.value.post('/update_exif', { path, exif })
  return resp.data as { success: boolean, message: string }
}

export const getImageExif = async (path: string) => {
  return (await axiosInst.value.get(`/image_exif?path=${encodeURIComponent(path)}`))
    .data as Record<string, string>
}

export const getImageGenerationInfoBatch = async (paths: string[]) => {
  if (!paths.length) {
    return {}
  }
  const resp = await axiosInst.value.post('/image_geninfo_batch', { paths })
  return resp.data
}

export const openFolder = async (path: string) => {
  await axiosInst.value.post('/open_folder', { path })
}

export const openWithDefaultApp = async (path: string) => {
  await axiosInst.value.post('/open_with_default_app', { path })
}

export interface Top4MediaInfo extends FileNodeInfo {
  media_type: 'video' | 'image'
}

export const batchGetDirTop4MediaInfo = async (paths: string[]) => {
  const resp = await axiosInst.value.post('/batch_top_4_media_info', { paths })
  return resp.data as Dict<Top4MediaInfo[]>
}

export const setAppFeSetting = async (name: keyof GlobalConf['app_fe_setting'], setting: Record<string, any>) => {
  await axiosInst.value.post('/app_fe_setting', { name, value: JSON.stringify(setting) })
}

/**
 * 将动态命名的设置写入本机 app_fe_setting KV。
 * 用于需要“后端持久化”的少量功能开关/配置（例如 TopicSearch 的向量化范围）。
 */
export const setAppFeSettingForce = async (name: string, setting: Record<string, any>) => {
  await axiosInst.value.post('/app_fe_setting', { name, value: JSON.stringify(setting) })
}

export const removeAppFeSetting = async (name: keyof GlobalConf['app_fe_setting']) => {
  await axiosInst.value.delete('/app_fe_setting', { data: { name } })
}

export const setTargetFrameAsCover = async (body: { path: string, base64_img: string, updated_time: string }) => {
  await axiosInst.value.post('/set_target_frame_as_video_cover', body)
}

// AI 相关 API
export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AIChatRequest {
  messages: AIChatMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

export interface AIChatResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: AIChatMessage
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export const aiChat = async (req: AIChatRequest) => {
  const resp = await axiosInst.value.post('/ai-chat', req)
  return resp.data as AIChatResponse
}

// ========== Flatten Folder API ==========

export interface FlattenFolderReq {
  folder_path: string
  dry_run?: boolean
}

export interface FlattenFolderResp {
  success: boolean
  total_files: number
  conflicts: string[]
  moved_files?: number
  errors?: string[]
}

export const flattenFolder = async (req: FlattenFolderReq) => {
  const resp = await axiosInst.value.post('/flatten_folder', req)
  return resp.data as FlattenFolderResp
}
export interface ArchiveSettings {
  directory: string
  custom_directory: string
  default_directory: string
}
export const getArchiveSettings = async () => (await axiosInst.value.get<ArchiveSettings>('/archive_settings')).data
export const saveArchiveSettings = async (directory: string) => (await axiosInst.value.put<ArchiveSettings>('/archive_settings', { directory })).data
