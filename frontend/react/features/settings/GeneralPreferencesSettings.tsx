import { Alert, Select, Switch, Text } from '@mantine/core'
import { useState } from 'react'
import {
  imageExtensions,
  videoExtensions,
  audioExtensions
} from '../../../src/shared/lib/mediaFormats'
import { languageOptions, useLanguage } from '../../design/i18n'
import { SettingsCard, SettingsRow } from './components'
import {
  readGeneralPreferences,
  saveGeneralPreferences,
  type GeneralPreferences
} from './generalPreferences'
import { errorText } from './components'
import { useSettingsWritable } from './SettingsAccess'

export default function GeneralPreferencesSettings() {
  const { language, setLanguage, t } = useLanguage()
  const writable = useSettingsWritable()
  const [prefs, setPrefs] = useState(readGeneralPreferences)
  const [error, setError] = useState('')

  function update<K extends keyof GeneralPreferences>(key: K, value: GeneralPreferences[K]) {
    if (!writable) return
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    setError('')
    void saveGeneralPreferences(next).catch((cause) =>
      setError(errorText(cause, '保存通用偏好失败'))
    )
  }

  const formats = [
    { label: t('imagePlural'), extensions: imageExtensions },
    { label: t('videoPlural'), extensions: videoExtensions },
    { label: t('audioPlural'), extensions: audioExtensions }
  ]

  return (
    <>
      {error && <Alert color="red">{error}</Alert>}
      <SettingsCard title={t('basicActions')}>
        <SettingsRow label={t('lang')}>
          <Select
            aria-label={t('lang')}
            value={language}
            disabled={!writable}
            onChange={(value) => {
              if (!value) return
              setError('')
              void setLanguage(value as typeof language).catch((cause) =>
                setError(errorText(cause, '保存语言偏好失败'))
              )
            }}
            data={[...languageOptions]}
          />
        </SettingsRow>
        <SettingsRow label={t('longPressMenu')} description={t('longPressMenuHint')}>
          <Switch
            aria-label={t('longPressMenu')}
            checked={prefs.longPressOpenContextMenu}
            disabled={!writable}
            onChange={(event) => update('longPressOpenContextMenu', event.currentTarget.checked)}
          />
        </SettingsRow>
        <SettingsRow label={t('confirmSingleDelete')} description={t('confirmSingleDeleteHint')}>
          <Switch
            aria-label={t('confirmSingleDelete')}
            checked={prefs.confirmSingleDelete}
            disabled={!writable}
            onChange={(event) => update('confirmSingleDelete', event.currentTarget.checked)}
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard title={t('supportedFormats')} description={t('supportedFormatsHint')}>
        <div className="settings-format-list">
          {formats.map((format) => (
            <div className="settings-format-row" key={format.label}>
              <Text size="xs" c="dimmed">
                {format.label}
              </Text>
              <div>
                {format.extensions.map((extension) => (
                  <span key={extension}>{extension}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>
    </>
  )
}
