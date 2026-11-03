// Public application identity; never send local file paths or user data to the player.
export const YOUTUBE_PLAYER_IDENTITY = 'https://budget-terminal.app/'

export function youtubeEmbedUrl(videoId: string): string | null {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0`
}

export function isYouTubeEmbedUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === 'https://www.youtube-nocookie.com' && /^\/embed\/[A-Za-z0-9_-]{11}$/.test(url.pathname)
  } catch {
    return false
  }
}
