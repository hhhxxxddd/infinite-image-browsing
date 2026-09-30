import { useNotice } from '../../shared/notices'
import { Alert, Button, Group, Modal, NumberInput, Switch, Text } from '@mantine/core'
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react'
import { useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import { useLanguage } from '../../design/i18n'
import {
  readBrowsePreferences,
  saveBrowsePreferences,
  type BrowsePreferences
} from './browsePreferences'
import { errorText, SettingsCard, SettingsRow } from './components'
import { useSettingsWritable } from './SettingsAccess'

export default function BrowseSettings() {
  const { t } = useLanguage()
  const writable = useSettingsWritable()
  const [prefs, setPrefs] = useState(readBrowsePreferences)
  const [confirmRebuild, setConfirmRebuild] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState('')
  const setNotice = useNotice()

  function update<K extends keyof BrowsePreferences>(key: K, value: BrowsePreferences[K]) {
    if (!writable) return
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    setError('')
    void saveBrowsePreferences(next).catch((cause) =>
      setError(errorText(cause, '保存浏览偏好失败'))
    )
  }

  async function rebuild() {
    if (!writable) return
    setRebuilding(true)
    setError('')
    setNotice('')
    try {
      await apiFetch('/rebuild_index', { method: 'POST' })
      setNotice('索引重建已完成。返回媒体库刷新列表后即可查看结果。')
      setConfirmRebuild(false)
    } catch (cause) {
      setError(errorText(cause, '重建媒体索引失败'))
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <div className="settings-stack">
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}
      <SettingsCard title={t('browse')} description={t('browsePreferencesNote')}>
        <SettingsRow label={t('cardWidth')} description={t('cardWidthHint')}>
          <NumberInput
            aria-label={t('cardWidth')}
            suffix=" px"
            min={128}
            max={512}
            step={16}
            value={prefs.smallThumbnailWidth}
            disabled={!writable}
            onChange={(value) => update('smallThumbnailWidth', Number(value) || 176)}
          />
        </SettingsRow>
        <SettingsRow label={t('imageThumbnailPreview')} description={t('thumbnailHint')}>
          <Switch
            checked={prefs.enableThumbnail}
            disabled={!writable}
            onChange={(event) => update('enableThumbnail', event.currentTarget.checked)}
            aria-label={t('imageThumbnailPreview')}
          />
        </SettingsRow>
        {prefs.enableThumbnail && (
          <SettingsRow label={t('thumbnailShortEdge')} description={t('thumbnailShortEdgeHint')}>
            <NumberInput
              aria-label={t('thumbnailShortEdge')}
              suffix=" px"
              min={256}
              max={1024}
              step={64}
              value={prefs.gridThumbnailResolution}
              disabled={!writable}
              onChange={(value) => update('gridThumbnailResolution', Number(value) || 512)}
            />
          </SettingsRow>
        )}
      </SettingsCard>
      <SettingsCard title={t('mediaIndex')} description={t('mediaIndexHint')}>
        <SettingsRow label={t('autoCheckChanges')} description={t('autoCheckChangesHint')}>
          <Switch
            checked={prefs.autoUpdateIndex}
            disabled={!writable}
            onChange={(event) => update('autoUpdateIndex', event.currentTarget.checked)}
            aria-label={t('autoCheckChanges')}
          />
        </SettingsRow>
        <SettingsRow label={t('rebuildMediaIndex')} description={t('rebuildMediaIndexHint')}>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            disabled={!writable}
            onClick={() => setConfirmRebuild(true)}
          >
            {t('rebuildIndex')}
          </Button>
        </SettingsRow>
      </SettingsCard>
      <Modal
        opened={confirmRebuild}
        onClose={() => setConfirmRebuild(false)}
        centered
        title={t('rebuildMediaIndex')}
      >
        <Text size="sm">{t('rebuildIndexWarning')}</Text>
        {error && (
          <Alert color="red" mt="md">
            {error}
          </Alert>
        )}
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setConfirmRebuild(false)}>
            {t('cancel')}
          </Button>
          <Button loading={rebuilding} disabled={!writable} onClick={() => void rebuild()}>
            {t('startRebuild')}
          </Button>
        </Group>
      </Modal>
    </div>
  )
}
