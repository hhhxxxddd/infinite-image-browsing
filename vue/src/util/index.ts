import { t } from '@/i18n'
import { message } from 'ant-design-vue'
import { reactive } from 'vue'

import { FetchQueue, typedEventEmitter } from 'vue3-ts-util'
export * from './file'

export type Dict<T = any> = Record<string, T>
/**
 * 获取一个异步函数的返回类型，
 *
 * ReturnTypeAsync\<typeof fn\>
 */
export type ReturnTypeAsync<T extends (...arg: any) => Promise<any>> = Awaited<ReturnType<T>>
export const createReactiveQueue = () => reactive(new FetchQueue(-1, 0, -1, 'throw'))

export const copy2clipboardI18n = async (text: string, msg?: string) => {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
    } else {
      const input = document.createElement('input')
      input.value = text
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    message.success(msg ?? t('copied'))
  } catch {
    message.error('copy failed. maybe it\'s non-secure environment')
  }
}

export const { useEventListen: useGlobalEventListen, eventEmitter: globalEvents } =
  typedEventEmitter<{
    returnToIIB(): void
    updateGlobalSetting(): void
    searchIndexExpired(): void
    folderRenamed(source: string, destination: string): void
    imageCreated(path: string): void
    closeTabPane(tabIdx: number, key: string): void
    updateGlobalSettingDone(): void
    refreshFileView(args?: { paths?: string[] }): void
    openPromptEditor(data: { file: { name: string; fullpath: string }}): void
    promptEditorUpdated(): void
  }>()

type AsyncFunction<T> = (...args: any[]) => Promise<T>

export function makeAsyncFunctionSingle<T>(fn: AsyncFunction<T>): AsyncFunction<T> {
  let promise: Promise<T> | null = null
  let isExecuting = false

  return async function (this: any, ...args: any[]): Promise<T> {
    if (isExecuting) {
      // 如果当前有其他调用正在执行，直接返回上一个 Promise 对象
      return promise as Promise<T>
    }

    isExecuting = true

    try {
      // 执行异步函数并等待结果
      promise = fn.apply(this, args)
      const result = await promise
      return result
    } finally {
      isExecuting = false
    }
  }
}

export function removeQueryParams(keys: string[]): string {
  // 获取当前 URL
  const url: string = parent.location.href

  // 解析 URL，获取查询参数部分
  const searchParams: URLSearchParams = new URLSearchParams(parent.location.search)

  // 删除指定的键
  keys.forEach((key: string) => {
    searchParams.delete(key)
  })

  // 构建新的 URL
  const newUrl: string = `${url.split('?')[0]}${
    searchParams.size ? '?' : ''
  }${searchParams.toString()}`

  // 使用 pushState() 方法将新 URL 添加到浏览器历史记录中
  parent.history.pushState(null, '', newUrl)

  // 返回新的 URL
  return newUrl
}

export function unescapeHtml (string: string) {
  return `${string}`
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"',)
    .replace(/&#39;/g, '\'')
}
