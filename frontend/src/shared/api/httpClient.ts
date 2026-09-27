import { Modal, message } from 'ant-design-vue'
import axios, { AxiosInstance, isAxiosError } from 'axios'
import { t } from '@/shared/i18n/index'
import cookie from 'js-cookie'
import { delay } from 'vue3-ts-util'
import { computed, h, ref } from 'vue'
import { sha256Hex } from '@/shared/lib/sha256'
import { tauriConf } from '@/shared/lib/desktopConfig'

declare module 'axios' {
  interface AxiosRequestConfig {
    handledLocally?: boolean
  }
}

export const apiBase = computed(() =>
  tauriConf.value ? `http://127.0.0.1:${tauriConf.value.port}/api` : '/api'
)

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
          onInput: (event: Event) => {
            if (event.target instanceof HTMLInputElement) key.value = event.target.value
          },
          autocomplete: 'current-password',
          name: 'password',
          autocapitalize: 'off',
          spellcheck: false,
          style: 'width: 100%;'
        }),
      onOk() {
        finish(key.value)
      },
      onCancel() {
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
        if (
          err.response?.status === 401 &&
          err.response?.data?.detail?.type === 'secret_verification_failed'
        ) {
          const key = await promptServerKeyOnce()
          if (!key) {
            // user cancelled; leave the request rejected as-is
            throw err
          }

          cookie.set('OMNIGALLERY_SECRET', sha256Hex(key + '_ciallo'))

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
          if (!errmsg && typeof err.response?.data?.text === 'function') {
            errmsg = JSON.parse(await err.response?.data.text()).detail
          }
        } catch (e) {
          console.error(err.response, e)
        }
        errmsg ??= t('errorOccurred')
        if (!err.config?.handledLocally) message.error(errmsg)
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
