export function planAIEditSubmission({
  mainPath,
  referencePaths,
  referenceLimit,
  hasMask,
  useMask,
  supportsMask,
  providerLabel
}: {
  mainPath: string
  referencePaths: string[]
  referenceLimit: number
  hasMask: boolean
  useMask: boolean
  supportsMask: boolean
  providerLabel: string
}) {
  const references = [...new Set(referencePaths.filter((path) => path && path !== mainPath))]
  const limit = Number.isFinite(referenceLimit) ? Math.max(0, Math.floor(referenceLimit)) : 0
  const submittedReferences = references.slice(0, limit)
  const notices: string[] = []
  if (references.length > limit) {
    notices.push(
      limit === 0
        ? `${providerLabel}不支持参考图，本次忽略 ${references.length} 张。`
        : `本次使用前 ${limit} 张参考图，其余 ${references.length - limit} 张忽略。`
    )
  }
  if (hasMask && useMask && !supportsMask) notices.push(`${providerLabel}不支持遮罩，本次忽略。`)
  return {
    references: submittedReferences,
    submitMask: hasMask && useMask && supportsMask,
    notices
  }
}
