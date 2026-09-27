export function unescapeHtml (string: string) {
  return `${string}`
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"',)
    .replace(/&#39;/g, '\'')
}
