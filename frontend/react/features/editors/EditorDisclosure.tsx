import { useId, useState, type ReactNode } from 'react'
import { IconMinus, IconPlus } from '@tabler/icons-react'
import './EditorDisclosure.css'

/** Secondary options only. Primary tools belong directly in their inspector tab. */
export default function EditorDisclosure({
  title,
  children,
  defaultOpened = false,
  inline = false,
  className = ''
}: {
  title: ReactNode
  children: ReactNode
  defaultOpened?: boolean
  inline?: boolean
  className?: string
}) {
  const [opened, setOpened] = useState(defaultOpened)
  const id = useId()
  return (
    <section className={`editor-disclosure ${inline ? 'is-inline' : ''} ${className}`}>
      {inline ? (
        <div className="editor-disclosure-heading">{title}</div>
      ) : (
        <button
          className="editor-disclosure-toggle"
          type="button"
          aria-expanded={opened}
          aria-controls={id}
          onClick={() => setOpened((value) => !value)}
        >
          {opened ? <IconMinus size={14} aria-hidden /> : <IconPlus size={14} aria-hidden />}
          <span className="editor-disclosure-title">{title}</span>
          <span className="editor-disclosure-state">{opened ? '收起' : '展开'}</span>
        </button>
      )}
      <div id={id} className="editor-disclosure-content" hidden={!inline && !opened}>
        {children}
      </div>
    </section>
  )
}
