/** Validate links before handing them to the operating system's browser. */
export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 8192 || /[\u0000-\u0020\u007f]/.test(url)) return false
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password
  } catch {
    return false
  }
}
