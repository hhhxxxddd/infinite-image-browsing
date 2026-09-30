import '@mantine/core/styles.css'
import './design/global.css'

import { localStorageColorSchemeManager, MantineProvider } from '@mantine/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initializeApiClient } from './shared/apiClient'
import { appTheme } from './design/theme'
import { hydrateLanguage, LanguageProvider } from './design/i18n'
import App from './App'
import { readServerPreferences } from './features/settings/serverPreferences'
import { hydrateBrowsePreferences } from './features/settings/browsePreferences'
import { hydrateGeneralPreferences } from './features/settings/generalPreferences'
import { NoticeProvider } from './shared/notices'

const root = document.getElementById('react-app')
if (!root) throw new Error('React root element is missing')

void initializeApiClient()
  .catch((error: unknown) => {
    console.error('Unable to read desktop backend port', error)
  })
  .then(async () => {
    try {
      const saved = await readServerPreferences()
      hydrateLanguage(saved)
      hydrateBrowsePreferences(saved)
      hydrateGeneralPreferences(saved)
    } catch (error) {
      console.warn('Unable to load shared preferences; using local values', error)
    }
  })
  .finally(() => {
    createRoot(root).render(
      <StrictMode>
        <MantineProvider
          theme={appTheme}
          colorSchemeManager={localStorageColorSchemeManager({ key: 'omnigallery-react-theme' })}
          defaultColorScheme="light"
        >
          <LanguageProvider>
            <NoticeProvider>
              <App />
            </NoticeProvider>
          </LanguageProvider>
        </MantineProvider>
      </StrictMode>
    )
    window.dispatchEvent(new Event('omnigallery:react-mounted'))
  })
