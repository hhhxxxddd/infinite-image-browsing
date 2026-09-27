import { typedEventEmitter } from 'vue3-ts-util'

export const { useEventListen: useGlobalEventListen, eventEmitter: globalEvents } =
  typedEventEmitter<{
    returnToApplication(): void
    updateGlobalSetting(): void
    searchIndexExpired(): void
    folderRenamed(source: string, destination: string): void
    imageCreated(path: string): void
    closeTabPane(tabIdx: number, key: string): void
    updateGlobalSettingDone(): void
    refreshFileView(args?: { paths?: string[] }): void
    openPromptEditor(data: { file: { name: string; fullpath: string } }): void
    promptEditorUpdated(): void
  }>()
