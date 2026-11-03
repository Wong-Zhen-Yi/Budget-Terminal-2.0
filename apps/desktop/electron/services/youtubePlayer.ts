import type { BrowserWindow } from 'electron'
import { isYouTubeEmbedUrl, YOUTUBE_PLAYER_IDENTITY } from '../shared/youtubePlayer.js'

export function configureYouTubePlayer(window: BrowserWindow): void {
  const contents = window.webContents
  contents.session.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    if (details.webContentsId === contents.id && details.resourceType === 'subFrame' && isYouTubeEmbedUrl(details.url)) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'referer') delete headers[key]
      }
      headers.Referer = YOUTUBE_PLAYER_IDENTITY
    }
    callback({ requestHeaders: headers })
  })
}
