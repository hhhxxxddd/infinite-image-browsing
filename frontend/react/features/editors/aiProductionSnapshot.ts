import type { StudioDocument } from '../../../src/features/image-editor/model/imageStudioModel.ts'
import {
  readAnnotationPromptRules,
  validAnnotationTemplate,
  type AnnotationPromptRules
} from '../../../src/features/ai-workflows/model/annotationPrompt.ts'
import type { ParameterValue } from './aiWorkflowParameters.ts'
import { readStudioVersionDocument } from './studioVersionDocument.ts'

export interface AIProductionChoice {
  mode: 'router' | 'workflow'
  model: string
  workflowId: string
  aspectRatio: string
  imageSize: string
  annotationRules?: AnnotationPromptRules
}
export interface AIProductionSnapshot {
  version: 1
  purpose: 'image_edit' | 'image_generation'
  inputPath: string
  document: StudioDocument | null
  references: { path: string; document: StudioDocument | null }[]
  choice: AIProductionChoice
  parameters: Record<string, ParameterValue>
  useMask: boolean
  prompt: string
  negative: string
  outputName: string
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length <= limit

/** Reject incomplete versions instead of silently dropping an input or annotation. */
export function readAIProductionSnapshot(raw: string): AIProductionSnapshot {
  const fail = (): never => {
    throw new Error('AI 制作版本不完整或已损坏，未恢复任何内容')
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return fail()
  }
  if (
    !object(value) ||
    value.version !== 1 ||
    !['image_edit', 'image_generation'].includes(value.purpose as string) ||
    !text(value.inputPath, 2048) ||
    !Array.isArray(value.references) ||
    !object(value.choice) ||
    !['router', 'workflow'].includes(value.choice.mode as string) ||
    !text(value.choice.model, 200) ||
    !text(value.choice.workflowId, 200) ||
    !text(value.choice.aspectRatio, 30) ||
    !text(value.choice.imageSize, 30) ||
    !object(value.parameters) ||
    typeof value.useMask !== 'boolean' ||
    !text(value.prompt, 100000) ||
    !text(value.negative, 100000) ||
    !text(value.outputName, 200)
  )
    return fail()
  function canvas(candidate: unknown, path: string) {
    if (candidate === null && value && object(value) && value.purpose === 'image_generation')
      return null
    let parsed: StudioDocument
    try {
      parsed = readStudioVersionDocument(candidate)
    } catch {
      return fail()
    }
    if (!parsed.layers.some((layer) => layer.kind === 'image' && layer.path === path)) return fail()
    return parsed
  }
  const document = value.inputPath ? canvas(value.document, value.inputPath) : null
  if (!value.inputPath && value.document !== null) return fail()
  const paths = new Set<string>()
  const references = value.references.map((reference) => {
    if (
      !object(reference) ||
      !text(reference.path, 2048) ||
      !reference.path ||
      reference.path === value.inputPath ||
      paths.has(reference.path)
    )
      return fail()
    paths.add(reference.path)
    return { path: reference.path, document: canvas(reference.document, reference.path) }
  })
  if (!value.inputPath && references.length) return fail()
  if (value.choice.annotationRules !== undefined) {
    if (!object(value.choice.annotationRules)) return fail()
    for (const kind of ['rect', 'arrow', 'paint'])
      if (
        value.choice.annotationRules[kind] !== undefined &&
        !validAnnotationTemplate(value.choice.annotationRules[kind])
      )
        return fail()
  }
  for (const parameter of Object.values(value.parameters))
    if (
      typeof parameter !== 'boolean' &&
      typeof parameter !== 'string' &&
      !(typeof parameter === 'number' && Number.isFinite(parameter))
    )
      return fail()
  return {
    version: 1,
    purpose: value.purpose as AIProductionSnapshot['purpose'],
    inputPath: value.inputPath,
    document,
    references,
    choice: {
      mode: value.choice.mode as AIProductionChoice['mode'],
      model: value.choice.model,
      workflowId: value.choice.workflowId,
      aspectRatio: value.choice.aspectRatio,
      imageSize: value.choice.imageSize,
      annotationRules: readAnnotationPromptRules(value.choice.annotationRules)
    },
    parameters: value.parameters as Record<string, ParameterValue>,
    useMask: value.useMask,
    prompt: value.prompt,
    negative: value.negative,
    outputName: value.outputName
  }
}

/** An explicit empty saved input must survive reload; only a missing key uses the asset fallback. */
export function initialAIProductionInputPath(
  savedPath: string | null,
  fixedSource: string | undefined,
  fallback: string
) {
  return fixedSource || (savedPath === null ? fallback : savedPath)
}

/** Null values are deletions. Apply every entry in one workspace transaction. */
export function aiProductionSnapshotWrites(
  suffix: string,
  draftId: string,
  snapshot: AIProductionSnapshot
) {
  const next = readAIProductionSnapshot(JSON.stringify(snapshot))
  const prefix = `omnigallery:ai-production-${next.purpose === 'image_generation' ? 'generation-' : ''}`
  const activeSuffix = next.purpose === 'image_edit' ? `:${next.document?.id || draftId}` : ''
  const writes = new Map<string, string | null>([
    [`omnigallery:ai-production-active-purpose-v1:${suffix}`, next.purpose],
    [`${prefix}choice-v1:${suffix}`, JSON.stringify({ ...next.choice, useMask: next.useMask })],
    [
      `${prefix}parameters-v1:${suffix}`,
      JSON.stringify({ workflowId: next.choice.workflowId, values: next.parameters })
    ],
    [`${prefix}prompt-v1:${suffix}${activeSuffix}`, next.prompt],
    [`${prefix}negative-v1:${suffix}${activeSuffix}`, next.negative],
    [`omnigallery:ai-production-output-name-v1:${suffix}`, next.outputName],
    [`omnigallery:ai-image-edit-asset-v1:${suffix}`, next.inputPath]
  ])
  if (next.inputPath) {
    writes.set(
      `omnigallery:ai-image-refs-v1:${suffix}:${encodeURIComponent(next.inputPath)}`,
      JSON.stringify(next.references.map((reference) => reference.path))
    )
    writes.set(
      `omnigallery:ai-image-edit-v1:${suffix}:${encodeURIComponent(next.inputPath)}`,
      next.document ? JSON.stringify(next.document) : null
    )
    for (const reference of next.references)
      writes.set(
        `omnigallery:ai-image-ref-v1:${suffix}:${encodeURIComponent(next.inputPath)}:${encodeURIComponent(reference.path)}`,
        reference.document ? JSON.stringify(reference.document) : null
      )
  }
  return writes
}
