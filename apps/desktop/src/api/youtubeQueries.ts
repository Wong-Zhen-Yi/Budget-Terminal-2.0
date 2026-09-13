import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import type {
  Envelope,
  YouTubePayload,
  YouTubeThumbnailPayload,
  YouTubeVideo,
} from '@shared/contract'
import { api, queryKeys } from './client'
import { forcing } from './queries'

export function useYouTube(tickers: string[]): UseQueryResult<Envelope<YouTubePayload>> {
  return useQuery({
    queryKey: queryKeys.youtube(tickers),
    queryFn: () => api.youtube({ tickers, force: forcing() }),
    enabled: tickers.length > 0,
    refetchInterval: false,
    staleTime: Infinity,
    retry: false,
  })
}

export function useRefreshYouTube(tickers: string[]): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    if (!tickers.length) return
    await queryClient.fetchQuery({
      queryKey: queryKeys.youtube(tickers),
      queryFn: () => api.youtube({ tickers, force: true }),
      staleTime: 0,
    })
  }, [queryClient, tickers])
}

export function useYouTubeThumbnail(
  video: YouTubeVideo | null,
): UseQueryResult<Envelope<YouTubeThumbnailPayload>> {
  const videoId = video?.videoId ?? ''
  const thumbnailUrl = video?.thumbnailUrl ?? ''
  return useQuery({
    queryKey: queryKeys.youtubeThumbnail(videoId, thumbnailUrl),
    queryFn: () => api.youtubeThumbnail({ videoId, thumbnailUrl }),
    enabled: Boolean(video && (videoId || thumbnailUrl)),
    refetchInterval: false,
    staleTime: Infinity,
    retry: false,
  })
}
