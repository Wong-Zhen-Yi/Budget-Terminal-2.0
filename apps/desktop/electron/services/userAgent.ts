/**
 * The browser `User-Agent` the non-Yahoo fetches send.
 *
 * Node's `fetch` announces itself as undici, which several publisher edges answer with a
 * 403 or a consent interstitial. CNN's Fear & Greed endpoint was the first caller to need
 * this; the News page's feeds, article previews and thumbnails are the rest.
 */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
