import { useEffect, useState } from 'react'
import { createFrameAction } from './frameAction'

export function useFrameAction() {
  const [actions] = useState(() => createFrameAction())
  useEffect(() => actions.cancel, [actions])
  return actions
}
