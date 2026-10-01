import { Notification, Portal, type MantineColor } from '@mantine/core'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle
} from '@tabler/icons-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useLanguage } from '../design/i18n'

type NoticeKind = 'success' | 'info' | 'warning' | 'error'
type Notice = { id: number; message: string; color: MantineColor; kind: NoticeKind }
type NoticePosition = { left: number; bottom: number; maxWidth: number; editorActive: boolean }
type PublishNotice = (
  message: string,
  color: MantineColor,
  previousId?: number,
  kind?: NoticeKind
) => number | undefined

const NoticeContext = createContext<PublishNotice | null>(null)
const noticeDuration = { success: 2500, info: 4000, warning: 6000, error: 8000 }
const noticeIcon = {
  success: IconCircleCheck,
  info: IconInfoCircle,
  warning: IconAlertTriangle,
  error: IconAlertCircle
}

function isVisible(element: Element) {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0
}

/** Keep feedback near the active workspace, above its selection or transport controls. */
function useNoticePosition(active: boolean) {
  const [position, setPosition] = useState<NoticePosition | null>(null)
  useLayoutEffect(() => {
    if (!active) return
    let frame = 0
    const resizeObserver = new ResizeObserver(() => schedule())
    const observed = new Set<Element>()
    const measure = () => {
      const editor = Array.from(document.querySelectorAll('.react-editor-shell')).find(isVisible)
      const scope = editor ?? document.querySelector('.omni-main') ?? document.body
      const materialBar = editor
        ? Array.from(editor.querySelectorAll('.react-material-bar')).find(isVisible)
        : undefined
      const region = (materialBar ?? scope).getBoundingClientRect()
      const left = Math.max(16, region.left)
      const right = Math.min(window.innerWidth - 16, region.right)
      const maxWidth = Math.max(0, Math.min(420, right - left - 16))
      const center = (left + right) / 2
      let bottom = 18
      const obstacles = Array.from(
        scope.querySelectorAll(
          editor
            ? '.react-material-bar, .react-audio-controls, .video-transport'
            : '.ml-selection-bar'
        )
      ).filter(isVisible)
      for (const obstacle of obstacles) {
        const rect = obstacle.getBoundingClientRect()
        if (rect.left < center + maxWidth / 2 && rect.right > center - maxWidth / 2) {
          bottom = Math.max(bottom, window.innerHeight - rect.top + 12)
        }
      }
      for (const element of [scope, materialBar, ...obstacles]) {
        if (element && !observed.has(element)) {
          observed.add(element)
          resizeObserver.observe(element)
        }
      }
      const next = {
        left: center,
        bottom: Math.min(bottom, Math.max(18, window.innerHeight - 72)),
        maxWidth,
        editorActive: Boolean(editor)
      }
      setPosition((previous) =>
        previous &&
        previous.left === next.left &&
        previous.bottom === next.bottom &&
        previous.maxWidth === next.maxWidth &&
        previous.editorActive === next.editorActive
          ? previous
          : next
      )
    }
    function schedule() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
    }
  }, [active])
  return position
}

function NoticeCard({ notice, dismiss }: { notice: Notice; dismiss: (id: number) => void }) {
  const { t } = useLanguage()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  useEffect(() => {
    if (paused) return
    const timeout = window.setTimeout(() => dismiss(notice.id), noticeDuration[notice.kind])
    return () => window.clearTimeout(timeout)
  }, [notice.id, notice.kind, dismiss, paused])

  const Icon = noticeIcon[notice.kind]

  return (
    <Notification
      className="omni-notice"
      color={notice.color}
      icon={<Icon size={16} stroke={1.7} />}
      withBorder
      role={notice.kind === 'error' ? 'alert' : 'status'}
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
  const position = useNoticePosition(notices.length > 0)
  const publish = useCallback<PublishNotice>((message, color, previousId, kind) => {
    const resolvedKind =
      kind ??
      (color === 'red'
        ? 'error'
        : color === 'yellow' || color === 'orange'
          ? 'warning'
          : color === 'teal' || color === 'green'
            ? 'success'
            : 'info')
    const notice = message
      ? {
          id: ++nextId.current,
          message,
          color: resolvedKind === 'error' ? 'red' : color,
          kind: resolvedKind
        }
      : undefined
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
        <div
          className="omni-notices"
          style={
            position
              ? { left: position.left, bottom: position.bottom, maxWidth: position.maxWidth }
              : { visibility: 'hidden' }
          }
          data-mantine-color-scheme={position?.editorActive ? 'dark' : undefined}
          aria-live="polite"
          aria-relevant="additions text"
        >
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
    (message: string, options?: { kind?: NoticeKind }) => {
      previousId.current = publish(message, color, previousId.current, options?.kind)
    },
    [publish, color]
  )
}
