import { useEffect, useRef, useState } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconTool } from '@tabler/icons-react'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { SourceRelinkSource } from './sourceRelink'
import {
  projectSourceHealth,
  type ProjectSourceInspection,
  type ProjectSourceKind
} from './projectSources'
import { inspectProjectSources } from './projectSourceInspection'
import { subscribeArtifactDeletion } from './editorArtifactEvents'
import './SourceRepairButton.css'

export default function SourceRepairButton({
  workspaceId,
  draftId,
  kind,
  sources,
  repairing,
  onClick
}: {
  workspaceId: string
  draftId: string
  kind: ProjectSourceKind
  sources: SourceRelinkSource[]
  repairing: boolean
  onClick: () => void
}) {
  // Clip timings are validated against the cached headers without probing again on every edit.
  const sourceKey = JSON.stringify(sources.map(({ path, kind }) => [path, kind]).sort())
  const key = JSON.stringify([workspaceId, draftId, kind, sourceKey])
  const [snapshot, setSnapshot] = useState<{
    key: string
    values: ProjectSourceInspection[]
    error: boolean
  } | null>(null)
  const [checking, setChecking] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const lastCheck = useRef(0)

  useEffect(() => {
    if (repairing) return
    const controller = new AbortController()
    lastCheck.current = Date.now()
    setChecking(true)
    const assets: Pick<WorkspaceAsset, 'path' | 'kind'>[] = (
      JSON.parse(sourceKey) as [string, WorkspaceAsset['kind']][]
    ).map(([path, kind]) => ({ path, kind }))
    void inspectProjectSources(
      { workspace_id: workspaceId, document_id: draftId, kind },
      assets,
      controller.signal
    )
      .then((values) => {
        if (!controller.signal.aborted) setSnapshot({ key, values, error: false })
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSnapshot((current) => ({
            key,
            values: current?.key === key ? current.values : [],
            error: true
          }))
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })
    return () => controller.abort()
  }, [workspaceId, draftId, kind, sourceKey, key, repairing, refresh])

  useEffect(() => {
    const recheck = () => {
      if (
        !repairing &&
        document.visibilityState === 'visible' &&
        Date.now() - lastCheck.current > 5000
      )
        setRefresh((value) => value + 1)
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    const paths = new Set((JSON.parse(sourceKey) as [string, string][]).map(([path]) => path))
    const unsubscribe = subscribeArtifactDeletion(({ path }) => {
      if (!repairing && paths.has(path)) setRefresh((value) => value + 1)
    })
    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
      unsubscribe()
    }
  }, [repairing, sourceKey])

  const current = snapshot?.key === key ? snapshot : null
  const problems = sources.filter((source) => {
    const state = projectSourceHealth(
      source,
      current?.values.find((item) => item.path === source.path && item.kind === source.kind)
    ).state
    return state !== 'available' && state !== 'unchecked'
  }).length
  const label = problems
    ? `修复素材 · ${problems} 项需要修复`
    : checking
      ? '正在检查素材…'
      : current?.error
        ? '无法检查素材，点击重新检查'
        : '修复素材'
  return (
    <Tooltip label={label} position="right">
      <ActionIcon
        variant={problems ? 'filled' : 'subtle'}
        color={problems ? 'red' : undefined}
        className="source-repair-action"
        data-needs-repair={problems > 0}
        aria-label="修复素材"
        aria-description={label}
        onClick={onClick}
      >
        <IconTool size={19} />
      </ActionIcon>
    </Tooltip>
  )
}
