import { create } from 'zustand'
import type { YouTubeVideo } from '@shared/contract'
import { youtubeEmbedUrl } from '@shared/youtubePlayer'

interface PlayerState {
  video: YouTubeVideo | null
  floating: boolean
  returnRequest: number
  returnToVideo: () => void
  slot: HTMLDivElement | null
  slotVideoId: string
  play: (video: YouTubeVideo) => void
  close: () => void
  setFloating: (floating: boolean) => void
  setSlot: (slot: HTMLDivElement | null, videoId: string) => void
}

export const useYouTubePlayer = create<PlayerState>((set) => ({
  video: null,
  floating: false,
  returnRequest: 0,
  returnToVideo: () => set(state => ({ floating: false, returnRequest: state.returnRequest + 1 })),
  slot: null,
  slotVideoId: '',
  play: video => {
    if (youtubeEmbedUrl(video.videoId)) set({ video, floating: false })
  },
  close: () => set({ video: null, floating: false }),
  setFloating: floating => set({ floating }),
  setSlot: (slot, slotVideoId) => set({ slot, slotVideoId }),
}))
