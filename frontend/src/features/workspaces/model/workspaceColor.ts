/** Stored colors are opaque hex values; an absent color uses automatic styling. */
export function readWorkspaceColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const color = value.trim().toLowerCase()
  if (/^#[a-f0-9]{6}$/.test(color)) return color
  if (/^#[a-f0-9]{3}$/.test(color))
    return '#' + [...color.slice(1)].map((channel) => channel + channel).join('')
}
