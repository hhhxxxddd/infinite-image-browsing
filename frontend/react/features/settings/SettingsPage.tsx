import { Group, SegmentedControl, Table, Text, useMantineColorScheme } from '@mantine/core'
import {
  IconAdjustmentsHorizontal,
  IconBolt,
  IconBrain,
  IconCloud,
  IconKeyboard,
  IconPalette,
  IconPhoto,
  IconSettings,
  IconTags
} from '@tabler/icons-react'
import { useState } from 'react'
import {
  aiImageEditorShortcuts,
  browseShortcuts,
  imageStudioShortcuts
} from '../../../src/shared/lib/shortcut'
import { SettingsCard, SettingsRow } from './components'
import { useLanguage, type UiKey } from '../../design/i18n'
import GeneralPreferencesSettings from './GeneralPreferencesSettings'
import StorageSettings from './StorageSettings'
import BrowseSettings from './BrowseSettings'
import TagSettings from './TagSettings'
import RuntimeSettings from './RuntimeSettings'
import AISettings from './AISettings'
import SyncSettings from './SyncSettings'
import { SettingsAccess } from './SettingsAccess'
import { PageFrame } from '../../shared/PageFrame'
import './settings.css'

type Tab = 'general' | 'appearance' | 'browse' | 'tags' | 'runtime' | 'ai' | 'shortcuts' | 'sync'

const tabs = [
  { key: 'general', labelKey: 'general', icon: IconSettings },
  { key: 'appearance', labelKey: 'appearance', icon: IconPalette },
  { key: 'browse', labelKey: 'browse', icon: IconPhoto },
  { key: 'tags', labelKey: 'tagConfiguration', icon: IconTags },
  { key: 'runtime', labelKey: 'runtime', icon: IconBolt },
  { key: 'ai', labelKey: 'aiAccess', icon: IconBrain },
  { key: 'shortcuts', labelKey: 'shortcuts', icon: IconKeyboard },
  { key: 'sync', labelKey: 'syncSettings', icon: IconCloud }
] as const

function AppearanceSettings() {
  const { t } = useLanguage()
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  return (
    <div className="settings-stack">
      <SettingsCard title={t('appearanceTitle')} description={t('appearanceDescription')}>
        <SettingsRow label={t('colorMode')} description={t('appearanceNote')}>
          <SegmentedControl
            value={colorScheme}
            onChange={(value) => setColorScheme(value as 'light' | 'dark' | 'auto')}
            data={[
              { label: t('light'), value: 'light' },
              { label: t('dark'), value: 'dark' },
              { label: t('system'), value: 'auto' }
            ]}
            aria-label={t('colorMode')}
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard title={t('interfaceNote')} description={t('interfaceNoteDescription')}>
        <div className="settings-appearance-sample">
          <div className="settings-appearance-sample-art">
            <IconAdjustmentsHorizontal size={28} stroke={1.5} />
          </div>
          <div>
            <strong>{t('contentFirst')}</strong>
            <Text c="dimmed" size="sm">
              {t('contentFirstNote')}
            </Text>
          </div>
          <Group gap="xs" ml="auto">
            <span className="settings-appearance-swatch settings-appearance-swatch-secondary">
              {t('secondaryAction')}
            </span>
            <span className="settings-appearance-swatch settings-appearance-swatch-primary">
              {t('primaryAction')}
            </span>
          </Group>
        </div>
      </SettingsCard>
    </div>
  )
}

function ShortcutSettings() {
  const { t } = useLanguage()
  const groups = [
    { name: t('mediaListPreview'), values: browseShortcuts },
    { name: t('imageStudio'), values: imageStudioShortcuts },
    { name: t('aiImageEdit'), values: aiImageEditorShortcuts }
  ]
  return (
    <div className="settings-stack">
      {groups.map((group) => (
        <SettingsCard key={group.name} title={group.name} description={t('fixedShortcuts')}>
          <Table
            striped
            highlightOnHover
            verticalSpacing="sm"
            horizontalSpacing="md"
            className="settings-shortcut-table"
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('action')}</Table.Th>
                <Table.Th>{t('shortcuts')}</Table.Th>
                <Table.Th>{t('location')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {group.values.map((shortcut, index) => (
                <Table.Tr key={`${shortcut.keys}-${index}`}>
                  <Table.Td>{shortcut.action}</Table.Td>
                  <Table.Td>
                    <kbd>{shortcut.keys}</kbd>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {shortcut.scope}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </SettingsCard>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  const { t } = useLanguage()
  const [tab, setTab] = useState<Tab>('general')
  return (
    <PageFrame
      className="settings-frame"
      scrollKey={tab}
      header={
        <div className="omni-page-heading">
          <div>
            <h2 className="omni-page-title">{t('settings')}</h2>
            <p className="omni-page-description">{t('settingsDescription')}</p>
          </div>
          <span className="settings-heading-icon" aria-hidden="true">
            <IconAdjustmentsHorizontal size={20} stroke={1.7} />
          </span>
        </div>
      }
    >
      <div className="omni-content-inner settings-page">
        <div className="settings-layout">
          <nav className="settings-tabs" aria-label={t('settings')}>
            {tabs.map((item) => {
              const Icon = item.icon
              return (
                <button
                  type="button"
                  key={item.key}
                  className={`settings-tab${tab === item.key ? ' is-active' : ''}`}
                  aria-current={tab === item.key ? 'page' : undefined}
                  onClick={() => setTab(item.key)}
                >
                  <Icon size={18} stroke={1.8} />
                  <span>{t(item.labelKey as UiKey)}</span>
                </button>
              )
            })}
          </nav>
          <SettingsAccess>
            <div className="settings-content" key={tab}>
              {tab === 'general' && (
                <div className="settings-stack">
                  <GeneralPreferencesSettings />
                  <StorageSettings />
                </div>
              )}
              {tab === 'appearance' && <AppearanceSettings />}
              {tab === 'browse' && <BrowseSettings />}
              {tab === 'tags' && <TagSettings />}
              {tab === 'runtime' && <RuntimeSettings />}
              {tab === 'ai' && <AISettings onOpenRuntime={() => setTab('runtime')} />}
              {tab === 'shortcuts' && <ShortcutSettings />}
              {tab === 'sync' && <SyncSettings />}
            </div>
          </SettingsAccess>
        </div>
      </div>
    </PageFrame>
  )
}
