import type { BrowserRequest } from './browser.js'

export function browserSearchUrl(query: string): string {
  const text = query.trim()
  if (!text || text.length > 4096) throw new Error('Enter a search between 1 and 4096 characters.')
  const url = new URL('https://duckduckgo.com/')
  url.searchParams.set('q', text)
  return url.href
}

/** Preserve explicit URLs (including unsafe ones for the main-process validator).
 * Ordinary words and phrases become searches, never guessed single-label hosts.
 */
export function browserInputRequest(value: string): BrowserRequest {
  const text = value.trim()
  if (!text) throw new Error('Enter a website address or search terms.')
  if (/^(?:site|filetype|intitle|inurl|after|before):/i.test(text)) return { action: 'search', query: text }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(?:https?|file|javascript|data|about|blob|chrome|edge|mailto|tel):/i.test(text)) {
    return { action: 'navigate', url: text }
  }
  if (/^(?:[^/?#\s]+\.[^/?#\s]+|localhost|\[[^\]]+\])(?::\d+)?(?:[/?#][\s\S]*)?$/i.test(text)) {
    return { action: 'navigate', url: `https://${text}` }
  }
  return { action: 'search', query: text }
}
