import { useLayoutEffect, type RefObject } from 'react'

/** Keep floating tool settings beside the rail without resizing the canvas. */
export function useEditorToolAnchor(railRef: RefObject<HTMLElement | null>, active = true) {
  useLayoutEffect(() => {
    const rail = railRef.current
    const shell = rail?.closest<HTMLElement>('.react-editor-shell')
    if (!active || !rail || !shell) return
    const positionPanels = () => {
      const bounds = rail.getBoundingClientRect()
      shell.style.setProperty('--image-tool-panel-top', `${bounds.top}px`)
      shell.style.setProperty('--image-tool-panel-left', `${bounds.right + 12}px`)
    }
    const observer = new ResizeObserver(positionPanels)
    observer.observe(rail)
    observer.observe(shell)
    positionPanels()
    return () => {
      observer.disconnect()
      shell.style.removeProperty('--image-tool-panel-top')
      shell.style.removeProperty('--image-tool-panel-left')
    }
  }, [railRef, active])
}
