import type { InjectionKey, Ref } from 'vue'

// Shared by every preview opened inside a workbench, including teleported pickers and editors.
export const assetPreviewWorkspaceNameKey: InjectionKey<Readonly<Ref<string | undefined>>> = Symbol(
  'asset-preview-workspace-name'
)
