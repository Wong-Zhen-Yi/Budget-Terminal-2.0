import type {
  EnvelopeError,
  YouTubeThumbnailPayload,
  YouTubeThumbnailRequest,
} from '../shared/contract.js'
import { err } from '../shared/envelope.js'
import { getNewsThumbnail } from './news/images.js'

function trustedThumbnail(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('ytimg.com') ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function candidates(request: YouTubeThumbnailRequest): string[] {
  const values: string[] = []
  const supplied = trustedThumbnail(request.thumbnailUrl)
  if (supplied) values.push(supplied)
  const videoId = request.videoId.trim()
  if (/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    for (const filename of [
      'maxresdefault.jpg',
      'sddefault.jpg',
      'hqdefault.jpg',
      'mqdefault.jpg',
      'default.jpg',
    ]) {
      values.push(`https://i.ytimg.com/vi/${videoId}/${filename}`)
    }
  }
  return [...new Set(values)]
}

export async function getYouTubeThumbnail(
  request: YouTubeThumbnailRequest,
): Promise<{ payload: YouTubeThumbnailPayload; errors: EnvelopeError[] }> {
  let lastReason = 'Thumbnail unavailable.'
  for (const url of candidates(request)) {
    const result = await getNewsThumbnail(url)
    if (result.payload.dataUri) {
      return {
        payload: { dataUri: result.payload.dataUri, resolvedUrl: url },
        errors: [],
      }
    }
    lastReason = result.errors[0]?.reason ?? lastReason
  }
  return {
    payload: { dataUri: '', resolvedUrl: '' },
    errors: [err('YouTube image', lastReason, 'youtubeThumbnail', request.videoId)],
  }
}
