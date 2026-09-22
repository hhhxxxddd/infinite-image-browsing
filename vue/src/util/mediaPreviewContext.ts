import type { InjectionKey } from 'vue'
export const mediaPreviewKey: InjectionKey<(index: number) => void> = Symbol('media-preview')
