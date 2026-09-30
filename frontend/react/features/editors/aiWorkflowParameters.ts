export type ParameterValue = string | number | boolean
export interface AIWorkflowParameter {
  id: string
  name: string
  kind: 'number' | 'text' | 'boolean' | 'select'
  number_display?: 'input' | 'slider'
  targets: { node_id: string; input: string }[]
  options: { name: string; values: string[] }[]
  minimum: number | null
  maximum: number | null
  step: number | null
}
export interface ParameterizedWorkflow {
  id: string
  parameters: AIWorkflowParameter[]
  parameter_defaults: Record<string, ParameterValue[]>
}

export function initializeAIWorkflowParameters(
  workflow: ParameterizedWorkflow,
  saved?: { workflowId?: string; values?: Record<string, unknown> } | null
): Record<string, ParameterValue> {
  const values: Record<string, ParameterValue> = {}
  for (const parameter of workflow.parameters) {
    if (parameter.kind === 'select') {
      values[parameter.id] = -1
      continue
    }
    const original = workflow.parameter_defaults?.[parameter.id]?.[0]
    values[parameter.id] =
      typeof original === 'boolean' || typeof original === 'number' || typeof original === 'string'
        ? original
        : parameter.kind === 'number'
          ? 0
          : parameter.kind === 'boolean'
            ? false
            : ''
  }
  if (saved?.workflowId === workflow.id && saved.values) {
    for (const id of Object.keys(values)) {
      const prior = saved.values[id]
      if (typeof prior === typeof values[id]) values[id] = prior as ParameterValue
    }
  }
  return values
}

export function validAIWorkflowParameters(
  workflow: ParameterizedWorkflow,
  values: Record<string, ParameterValue>
): boolean {
  return workflow.parameters.every((parameter) => {
    const value = values[parameter.id]
    if (parameter.kind === 'select')
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= -1 &&
        value < parameter.options.length
      )
    if (parameter.kind === 'boolean') return typeof value === 'boolean'
    if (parameter.kind === 'text') return typeof value === 'string'
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (parameter.minimum === null || value >= parameter.minimum) &&
      (parameter.maximum === null || value <= parameter.maximum)
    )
  })
}

export function aiWorkflowParameterOverrides(
  workflow: ParameterizedWorkflow,
  values: Record<string, ParameterValue>
): Record<string, ParameterValue> {
  const overrides: Record<string, ParameterValue> = {}
  for (const parameter of workflow.parameters) {
    const value = values[parameter.id]
    if (parameter.kind === 'select') {
      if (typeof value === 'number' && value >= 0) overrides[parameter.id] = value
    } else if (value !== workflow.parameter_defaults?.[parameter.id]?.[0])
      overrides[parameter.id] = value
  }
  return overrides
}
