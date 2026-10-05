import type { Caption } from './videoStudioModel'
import { textLimits } from '../../../src/features/media-editor/model/textTimeline.ts'

export const MAX_SUBTITLE_TEXT_LENGTH = textLimits.text

export function matchingSubtitles(captions: readonly Caption[], query: string) {
  const needle = query.trim().toLocaleLowerCase()
  return captions.filter((cue) => !needle || cue.text.toLocaleLowerCase().includes(needle))
}

export function offsetSubtitles(
  captions: Caption[],
  ids: readonly string[],
  seconds: number
): Caption[] {
  if (!Number.isFinite(seconds)) throw new Error('请输入有效的时间偏移')
  const selected = new Set(ids)
  if (
    captions.some(
      (cue) =>
        selected.has(cue.id) &&
        (cue.start + seconds < 0 || cue.start + seconds + cue.duration > 21600)
    )
  )
    throw new Error('偏移后有字幕超出 0–6 小时范围，请调整偏移')
  return captions.map((cue) =>
    selected.has(cue.id) ? { ...cue, start: Math.round((cue.start + seconds) * 1e6) / 1e6 } : cue
  )
}

export function replaceSubtitleText(
  captions: Caption[],
  ids: readonly string[],
  find: string,
  replacement: string
): Caption[] {
  if (!find) throw new Error('请输入要替换的文字')
  const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  const selected = new Set(ids)
  const result = captions.map((cue) =>
    selected.has(cue.id) ? { ...cue, text: cue.text.replace(pattern, () => replacement) } : cue
  )
  if (result.some((cue) => cue.text.length > MAX_SUBTITLE_TEXT_LENGTH))
    throw new Error(`单条字幕最多 ${MAX_SUBTITLE_TEXT_LENGTH} 字，原始字幕未修改`)
  return result
}

export function applySubtitleStyle(
  captions: Caption[],
  ids: readonly string[],
  source: Caption
): Caption[] {
  const selected = new Set(ids)
  return captions.map((cue) =>
    selected.has(cue.id) ? { ...cue, style: { ...source.style } } : cue
  )
}
