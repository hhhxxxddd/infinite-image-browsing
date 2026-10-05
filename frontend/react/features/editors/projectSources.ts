import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { AudioTimelineDocument } from '../../../src/features/media-editor/model/audioTimeline'
import { clipLocked, mapClips, type VideoTimelineDocument } from './videoStudioModel.ts'
import { videoRelinkSources } from './videoSources.ts'
import { sourceMetadata, type SourceMetadata } from './sourceRange.ts'
import {
  applySourceRelink,
  sourceRelinkCompatible,
  sourceRelinkError,
  type SourceRelinkSelection,
  type SourceRelinkSource
} from './sourceRelink.ts'

export type ProjectSourceKind = 'audio' | 'video'
export interface ProjectSourceInspection {
  path: string
  kind: WorkspaceAsset['kind']
  state: 'available' | 'missing' | 'unavailable' | 'invalid' | 'error'
  error: string
  metadata?: unknown
}
export interface ProjectSourceHealth {
  source: SourceRelinkSource
  state: ProjectSourceInspection['state'] | 'unchecked'
  error: string
  metadata?: SourceMetadata
}
export interface ProjectSourceRelinkSelection extends SourceRelinkSelection {
  metadata: SourceMetadata
}
export interface ProjectSourceCandidates {
  candidates: WorkspaceAsset[]
  complete: boolean
  case_sensitive: boolean
  scanned_entries: number
  skipped_directories: number
}
export const sourceFilename = (source: SourceRelinkSource) =>
  source.path.startsWith('workspace-artifact:')
    ? source.name
    : (source.path.split(/[\\/]/).filter(Boolean).at(-1) ?? source.name)

export function projectRelinkSources(
  document: AudioTimelineDocument,
  kind: 'audio'
): SourceRelinkSource[]
export function projectRelinkSources(
  document: VideoTimelineDocument,
  kind: 'video'
): SourceRelinkSource[]
export function projectRelinkSources(
  document: AudioTimelineDocument | VideoTimelineDocument,
  kind: ProjectSourceKind
): SourceRelinkSource[] {
  if (kind === 'video') return videoRelinkSources(document as VideoTimelineDocument)
  const result = new Map<string, SourceRelinkSource>()
  for (const track of (document as AudioTimelineDocument).tracks)
    for (const clip of track.clips) {
      let source = result.get(clip.path)
      if (!source) {
        source = { path: clip.path, name: clip.name, kind: clip.sourceKind ?? 'audio', clips: [] }
        result.set(clip.path, source)
      }
      source.clips.push({
        id: clip.id,
        sourceIn: clip.sourceIn,
        duration: clip.duration,
        rate: clip.rate ?? 1,
        requiresAudio: true,
        audioStream: clip.audioStream,
        requiresVideo: false
      })
    }
  return [...result.values()]
}

export function projectLockedSourcePaths(document: AudioTimelineDocument, kind: 'audio'): string[]
export function projectLockedSourcePaths(document: VideoTimelineDocument, kind: 'video'): string[]
export function projectLockedSourcePaths(
  document: AudioTimelineDocument | VideoTimelineDocument,
  kind: ProjectSourceKind
): string[] {
  if (kind === 'audio')
    return [
      ...new Set(
        (document as AudioTimelineDocument).tracks
          .filter((track) => track.locked)
          .flatMap((track) => track.clips.map((clip) => clip.path))
      )
    ]
  const doc = document as VideoTimelineDocument
  return [
    ...new Set(
      [
        ...doc.visuals.filter((clip) => clipLocked(doc, clip, 'visual')),
        ...doc.sounds.filter((clip) => clipLocked(doc, clip, 'sound'))
      ].map((clip) => clip.path)
    )
  ]
}

/** Includes all current references: a cut, relink or newly inserted clip invalidates an old review. */
export function projectSourceSignature(source: SourceRelinkSource): string {
  return JSON.stringify({
    path: source.path,
    kind: source.kind,
    clips: source.clips
      .map((clip) => ({
        id: clip.id,
        sourceIn: clip.sourceIn,
        duration: clip.duration,
        rate: clip.rate ?? 1,
        freeze: !!clip.freeze,
        audio: !!clip.requiresAudio,
        audioStream: clip.audioStream ?? 0,
        video: !!clip.requiresVideo
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  })
}

export function projectSourceHealth(
  source: SourceRelinkSource,
  inspection?: ProjectSourceInspection
): ProjectSourceHealth {
  if (!inspection || inspection.path !== source.path || inspection.kind !== source.kind)
    return { source, state: 'unchecked', error: '尚未检查' }
  if (inspection.state !== 'available')
    return { source, state: inspection.state, error: inspection.error }
  try {
    const metadata = sourceMetadata(inspection.metadata, inspection.kind)
    const error = sourceRelinkError(
      source,
      { path: source.path, name: source.name, kind: source.kind },
      metadata
    )
    return { source, state: error ? 'invalid' : 'available', error, metadata }
  } catch (cause) {
    return {
      source,
      state: 'invalid',
      error: cause instanceof Error ? cause.message : '源文件信息无效'
    }
  }
}

export function projectSourceMatches(
  source: SourceRelinkSource,
  result: ProjectSourceCandidates
): WorkspaceAsset[] {
  const normalized = (name: string) => (result.case_sensitive ? name : name.toLowerCase())
  const name = normalized(sourceFilename(source))
  return result.candidates.filter(
    (asset) =>
      normalized(asset.name) === name &&
      asset.path !== source.path &&
      sourceRelinkCompatible(source, asset)
  )
}

/** Unambiguous proposals remain a review step; incomplete scans and shared-name collisions stay empty. */
export function proposeProjectSourceChoices(
  sources: SourceRelinkSource[],
  result: ProjectSourceCandidates
): Record<string, string> {
  if (!result.complete) return {}
  const matches = sources.map((source) => ({
    source,
    choices: projectSourceMatches(source, result)
  }))
  const counts = new Map<string, number>()
  for (const item of matches)
    for (const candidate of item.choices)
      counts.set(candidate.path, (counts.get(candidate.path) ?? 0) + 1)
  return Object.fromEntries(
    matches.flatMap(({ source, choices }) =>
      choices.length === 1 && counts.get(choices[0].path) === 1
        ? [[source.path, choices[0].path]]
        : []
    )
  )
}

export function prepareProjectSourceRelinks(
  sources: SourceRelinkSource[],
  choices: Record<string, string>,
  candidates: WorkspaceAsset[],
  inspections: ProjectSourceInspection[],
  options: { readonly?: boolean; lockedPaths?: readonly string[] } = {}
): ProjectSourceRelinkSelection[] {
  if (options.readonly) throw new Error('当前制作文件为只读')
  const selections: ProjectSourceRelinkSelection[] = []
  for (const [path, replacementPath] of Object.entries(choices)) {
    if (!replacementPath) continue
    const source = sources.find((item) => item.path === path)
    const replacement = candidates.find((item) => item.path === replacementPath)
    if (!source || !replacement) throw new Error('素材清单已变化，请重新检查')
    if (options.lockedPaths?.includes(path)) throw new Error(`使用“${source.name}”的轨道已锁定`)
    if (replacement.path === path) throw new Error('请指定新的源文件')
    const inspected = inspections.find(
      (item) => item.path === replacement.path && item.kind === replacement.kind
    )
    if (!inspected || inspected.state !== 'available')
      throw new Error(inspected?.error || `尚未验证：${replacement.name}`)
    const metadata = sourceMetadata(inspected.metadata, replacement.kind)
    const error = sourceRelinkError(source, replacement, metadata)
    if (error) throw new Error(`${source.name}：${error}`)
    selections.push({ source, replacement, sourceDuration: metadata.duration, metadata })
  }
  if (!selections.length) throw new Error('请先选择要重新定位的素材')
  return selections
}

export function applyProjectSourceRelinks(
  document: AudioTimelineDocument,
  kind: 'audio',
  selections: ProjectSourceRelinkSelection[],
  readonly?: boolean
): AudioTimelineDocument
export function applyProjectSourceRelinks(
  document: VideoTimelineDocument,
  kind: 'video',
  selections: ProjectSourceRelinkSelection[],
  readonly?: boolean
): VideoTimelineDocument
export function applyProjectSourceRelinks(
  document: AudioTimelineDocument | VideoTimelineDocument,
  kind: ProjectSourceKind,
  selections: ProjectSourceRelinkSelection[],
  readonly = false
): AudioTimelineDocument | VideoTimelineDocument {
  if (readonly) throw new Error('当前制作文件为只读')
  const sources =
    kind === 'audio'
      ? projectRelinkSources(document as AudioTimelineDocument, 'audio')
      : projectRelinkSources(document as VideoTimelineDocument, 'video')
  const locked =
    kind === 'audio'
      ? projectLockedSourcePaths(document as AudioTimelineDocument, 'audio')
      : projectLockedSourcePaths(document as VideoTimelineDocument, 'video')
  const replacements = new Map<string, ProjectSourceRelinkSelection>()
  for (const selection of selections) {
    const source = sources.find((item) => item.path === selection.source.path)
    if (!source || projectSourceSignature(source) !== projectSourceSignature(selection.source))
      throw new Error('制作文件的素材引用已变化，请重新检查')
    if (replacements.has(source.path)) throw new Error('同一素材不能指定多个替换文件')
    if (locked.includes(source.path)) throw new Error(`使用“${source.name}”的轨道已锁定`)
    const error = sourceRelinkError(source, selection.replacement, selection.metadata)
    if (error || selection.sourceDuration !== selection.metadata.duration)
      throw new Error(error || '替换素材信息已变化')
    replacements.set(source.path, selection)
  }
  if (!replacements.size) return document
  const replace = <T extends { path: string; name: string; sourceDuration?: number }>(
    clip: T
  ): T => {
    const selection = replacements.get(clip.path)
    return selection ? applySourceRelink(clip, selection) : clip
  }
  return kind === 'video'
    ? mapClips(document as VideoTimelineDocument, replace)
    : {
        ...(document as AudioTimelineDocument),
        tracks: (document as AudioTimelineDocument).tracks.map((track) => ({
          ...track,
          clips: track.clips.map(replace)
        }))
      }
}
