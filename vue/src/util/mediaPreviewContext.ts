import type { InjectionKey } from 'vue'
export const mediaPreviewKey: InjectionKey<(index: number, mode?: 'preview' | 'edit') => void> = Symbol('media-preview')
