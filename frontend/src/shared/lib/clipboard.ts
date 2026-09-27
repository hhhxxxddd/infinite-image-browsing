import { message } from 'ant-design-vue'
import { t } from '@/shared/i18n'

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
    message.error("copy failed. maybe it's non-secure environment")
  }
}
