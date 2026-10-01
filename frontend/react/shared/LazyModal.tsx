import { useEffect, useState, type ReactNode } from 'react'
import { Modal, type ModalProps } from '@mantine/core'

/** Build dialog content on demand and retain it until the closing animation finishes. */
export function LazyModal({
  children,
  onExitTransitionEnd,
  ...props
}: Omit<ModalProps, 'children'> & { children: () => ReactNode }) {
  const [retainContent, setRetainContent] = useState(props.opened)
  useEffect(() => {
    if (props.opened) setRetainContent(true)
  }, [props.opened])

  return (
    <Modal
      {...props}
      onExitTransitionEnd={() => {
        setRetainContent(false)
        onExitTransitionEnd?.()
      }}
    >
      {(props.opened || retainContent) && children()}
    </Modal>
  )
}
