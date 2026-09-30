import { createContext } from 'react'
import type { AppLanguage, UiKey } from './i18n'
import type { zhHans } from '../../src/shared/i18n/zh-hans'

export type LocaleContextValue = {
  language: AppLanguage
  setLanguage: (value: AppLanguage) => Promise<void>
  t: (key: UiKey | keyof typeof zhHans) => string
}

// Keep the context identity independent of hot updates to translations and the provider.
export const LocaleContext = createContext<LocaleContextValue | null>(null)
