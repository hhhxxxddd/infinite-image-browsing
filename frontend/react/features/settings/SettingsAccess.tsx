import { Alert } from '@mantine/core'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { useLanguage } from '../../design/i18n'
import { errorText } from './components'

const WriteAccess = createContext(false)

export function useSettingsWritable() {
  return useContext(WriteAccess)
}

export function SettingsAccess({ children }: { children: ReactNode }) {
  const { language } = useLanguage()
  const [writable, setWritable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void apiFetch<{ is_readonly: boolean }>('/global_setting')
      .then((settings) => {
        if (active) {
          setWritable(!settings.is_readonly)
          setLoaded(true)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, '无法读取设置权限，修改操作已暂时禁用。'))
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <WriteAccess.Provider value={writable}>
      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}
      {loaded && !writable && (
        <Alert color="yellow" mb="md">
          {
            {
              zhHans: '当前处于只读模式，设置修改已禁用。',
              zhHant: '目前為唯讀模式，設定修改已停用。',
              en: 'Read-only mode: settings changes are disabled.',
              de: 'Schreibgeschützter Modus: Änderungen an Einstellungen sind deaktiviert.'
            }[language]
          }
        </Alert>
      )}
      {children}
    </WriteAccess.Provider>
  )
}
