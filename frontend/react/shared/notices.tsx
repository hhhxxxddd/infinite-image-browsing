import { Notification, Portal, type MantineColor } from '@mantine/core'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useLanguage } from '../design/i18n'

type Notice = { id: number; message: string; color: MantineColor }
type PublishNotice = (
  message: string,
  color: MantineColor,
  previousId?: number
) => number | undefined

const NoticeContext = createContext<PublishNotice | null>(null)

function NoticeCard({ notice, dismiss }: { notice: Notice; dismiss: (id: number) => void }) {
  const { t } = useLanguage()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  useEffect(() => {
    if (paused) return
    const timeout = window.setTimeout(() => dismiss(notice.id), 6000)
    return () => window.clearTimeout(timeout)
  }, [notice.id, dismiss, paused])

  return (
    <Notification
      className="omni-notice"
      color={notice.color}
      withBorder
      role="status"
      onClose={() => dismiss(notice.id)}
      closeButtonProps={{ 'aria-label': t('close') }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      {notice.message}
    </Notification>
  )
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const nextId = useRef(0)
  const publish = useCallback<PublishNotice>((message, color, previousId) => {
    const notice = message ? { id: ++nextId.current, message, color } : undefined
    setNotices((current) => {
      const remaining = current.filter((item) => item.id !== previousId)
      return notice ? [...remaining, notice].slice(-3) : remaining
    })
    return notice?.id
  }, [])
  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id))
  }, [])

  return (
    <NoticeContext.Provider value={publish}>
      {children}
      <Portal>
        <div className="omni-notices" aria-live="polite" aria-relevant="additions text">
          {notices.map((notice) => (
            <NoticeCard key={notice.id} notice={notice} dismiss={dismiss} />
          ))}
        </div>
      </Portal>
    </NoticeContext.Provider>
  )
}

/** Repeated messages replace the caller's previous notice and restart its lifetime. */
export function useNotice(color: MantineColor = 'teal') {
  const publish = useContext(NoticeContext)
  const previousId = useRef<number | undefined>(undefined)
  if (!publish) throw new Error('useNotice must be used within NoticeProvider')
  return useCallback(
    (message: string) => {
      previousId.current = publish(message, color, previousId.current)
    },
    [publish, color]
  )
}
