/** Match the exact shell document, never another path on the same origin. */
export function isTrustedRendererUrl(candidate: string, expected: string): boolean {
  try {
    const actual = new URL(candidate)
    const trusted = new URL(expected)
    actual.hash = ''
    trusted.hash = ''
    return actual.href === trusted.href
  } catch {
    return false
  }
}
