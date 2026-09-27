import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePersistedPreferences } from './persistedPreferences.ts'

test('valid persisted preferences keep their boolean, numeric and enum types', () => {
  const raw = {
    darkModeControl: 'dark',
    enableThumbnail: false,
    defaultGridCellWidth: 220,
    thumbnailSizePreset: 'custom',
    defaultSortingMethod: 'name-desc',
    lang: 'zhHans',
    ignoredConfirmActions: { deleteOneOnly: true },
    fileTypeFilter: ['image', 'audio']
  }
  assert.deepEqual(parsePersistedPreferences(raw), raw)
})

test('malformed settings and unknown properties never overwrite application state', () => {
  assert.deepEqual(
    parsePersistedPreferences({
      enableThumbnail: 'false',
      defaultGridCellWidth: -5,
      gridThumbnailResolution: Number.NaN,
      defaultSortingMethod: 'invalid',
      lang: 'invalid',
      recent: 'untrusted',
      tabList: [],
      fileTypeFilter: ['audio', null, 'script'],
      ignoredConfirmActions: { deleteOneOnly: 'yes' }
    }),
    { fileTypeFilter: ['audio'] }
  )
  assert.deepEqual(parsePersistedPreferences(null), {})
  assert.deepEqual(parsePersistedPreferences([]), {})
})
