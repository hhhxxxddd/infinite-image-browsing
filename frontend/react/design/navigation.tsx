import { createContext, useContext } from 'react'

export type EditorKind = 'image' | 'video' | 'audio' | 'ai-image' | 'ai-audio' | 'ai-video'

export type EditorNavigation = {
  openEditor: (kind: EditorKind, draftId?: string) => void
  closeEditor: () => void
}

export const EditorNavigationContext = createContext<EditorNavigation | null>(null)

export function useEditorNavigation(): EditorNavigation {
  const navigation = useContext(EditorNavigationContext)
  if (!navigation) throw new Error('useEditorNavigation requires EditorNavigationContext')
  return navigation
}
