import { Loader } from '@mantine/core'
import type { ReactNode } from 'react'
import { PageFrame } from './PageFrame'

export type StateMessageProps = {
  title: string
  description?: ReactNode
  icon?: ReactNode
  loading?: boolean
  role?: 'alert' | 'status'
  children?: ReactNode
}

/** A bounded message, also usable inside an editor's own layout. */
export function StateMessage({
  title,
  description,
  icon,
  loading = false,
  role = 'status',
  children
}: StateMessageProps) {
  return (
    <div className="omni-state-message" role={role} aria-busy={loading || undefined}>
      {loading ? <Loader size="sm" /> : icon}
      <h2>{title}</h2>
      {description && <div className="omni-state-description">{description}</div>}
      {children && <div className="omni-state-actions">{children}</div>}
    </div>
  )
}

/** Page states reserve the same chrome and body as the page they replace. */
export function PageState({
  pageTitle,
  standalone = false,
  ...message
}: StateMessageProps & { pageTitle?: string; standalone?: boolean }) {
  const content = (
    <div className="omni-state-center">
      <StateMessage {...message} />
    </div>
  )
  return standalone ? (
    <div className="omni-state-screen">{content}</div>
  ) : (
    <PageFrame
      className="omni-page-state"
      header={<span className="omni-state-page-title">{pageTitle}</span>}
    >
      {content}
    </PageFrame>
  )
}
