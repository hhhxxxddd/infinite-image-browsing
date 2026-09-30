export type AIImageChoice = { value: string; label: string }

/** Keep the first label, so a source snapshot keeps its provenance label. */
export function uniqueAIImageChoices(choices: AIImageChoice[]): AIImageChoice[] {
  const seen = new Set<string>()
  return choices.filter((choice) => {
    if (!choice.value || seen.has(choice.value)) return false
    seen.add(choice.value)
    return true
  })
}
