import type { StudioWorkflowParameter } from '../api/imageAi.ts'

export const parameterKindLabels = {
  text: '文本',
  number: '数值',
  boolean: '开关',
  select: '选项'
} as const

export interface WorkflowParameterNode {
  id: string
  title: string
  fields: { name: string; value: string | number | boolean }[]
}

/** Incomplete or unsuitable slider ranges keep the ordinary number input. */
export function parameterSliderRange(parameter: StudioWorkflowParameter) {
  if (parameter.kind !== 'number' || parameter.number_display !== 'slider') return null
  const { minimum, maximum, step } = parameter
  if (
    typeof minimum !== 'number' ||
    !Number.isFinite(minimum) ||
    typeof maximum !== 'number' ||
    !Number.isFinite(maximum) ||
    typeof step !== 'number' ||
    !Number.isFinite(step) ||
    minimum >= maximum ||
    step <= 0 ||
    step > maximum - minimum ||
    !Number.isFinite(maximum - minimum)
  )
    return null
  return { min: minimum, max: maximum, step }
}
