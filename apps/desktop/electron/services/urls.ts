/**
 * One definition of "a URL that may leave the app".
 *
 * It used to live inside `ipc/handlers.ts` for the news panel's open-external handler
 * alone. The News page added two more outbound fetches — the article preview and the
 * thumbnail proxy — both of which take a URL that arrived in a feed, so all three now
 * check the same predicate rather than each growing its own.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}
