import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { youtubeEmbedUrl } from '@shared/youtubePlayer'
import { useYouTubePlayer } from '@/stores/youtubePlayer'
import '@/styles/youtube.css'

/** Keep one iframe outside PageCache: moving or remounting it restarts YouTube. */
export function YouTubePlayer({ pageActive, onReturn, suppressed = false }: {
  pageActive: boolean
  onReturn: () => void
  suppressed?: boolean
}) {
  const { video, floating, slot, slotVideoId, close, setFloating, returnToVideo } = useYouTubePlayer()
  const [bounds, setBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const docked = pageActive && !floating && slotVideoId === video?.videoId
  useLayoutEffect(() => {
    if (!docked || !slot) { setBounds(null); return }
    const measure = () => {
      const rect = slot.getBoundingClientRect()
      setBounds(rect.width && rect.height ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [docked, slot])
  if (!video) return null
  const inline = docked && bounds !== null
  return createPortal(
    <section className={'youtube-player ' + (inline ? 'youtube-player--inline' : 'youtube-player--pip')}
      style={inline ? bounds : undefined} hidden={suppressed} aria-label={'Playing ' + video.title}>
      <header>
        <span title={video.title}>{video.title}</span>
        {inline
          ? <button type="button" onClick={() => setFloating(true)} aria-label="Picture in picture" title="Picture in picture">▣</button>
          : <button type="button" onClick={() => { returnToVideo(); onReturn() }} aria-label="Return to video" title="Return to video">↗</button>}
        <button type="button" onClick={close} aria-label="Close video player" title="Close video player">×</button>
      </header>
      <iframe key={video.videoId} src={youtubeEmbedUrl(video.videoId) ?? undefined} title={video.title}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
    </section>, document.body,
  )
}
