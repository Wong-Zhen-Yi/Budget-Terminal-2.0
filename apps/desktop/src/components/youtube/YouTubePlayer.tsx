import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useYouTubePlayer } from '@/stores/youtubePlayer'
import '@/styles/youtube.css'

/** Native playback survives PageCache eviction and transfers to the desktop PiP window. */
export function YouTubePlayer({ pageActive, onReturn, suppressed = false }: {
  pageActive: boolean
  onReturn: () => void
  suppressed?: boolean
}) {
  const { video, floating, slot, slotVideoId, close, setFloating, returnToVideo } = useYouTubePlayer()
  const [bounds, setBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
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
  useEffect(() => window.api.onYouTubePlayerAction(action => {
    if (action.videoId !== useYouTubePlayer.getState().video?.videoId) return
    if (action.action === 'close') close()
    else { returnToVideo(); onReturn() }
  }), [close, returnToVideo, onReturn])
  const inline = docked && bounds !== null
  useLayoutEffect(() => {
    let current = true
    const rect = surface.current?.getBoundingClientRect()
    const theme = getComputedStyle(document.documentElement)
    const color = (role: string) => theme.getPropertyValue('--color-' + role).trim()
    void window.api.youtubePlayer(video ? {
      videoId: video.videoId, title: video.title,
      floating: !docked, visible: !suppressed && (!docked || Boolean(rect?.width && rect?.height)),
      x: rect?.left ?? 0, y: rect?.top ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0,
      colors: { bg: color('bg'), raised: color('surface-raised'), hover: color('surface-hover'), text: color('text'), accent: color('accent') },
    } : null).then(result => {
      if (current) setError(result.errors[0]?.reason ?? '')
    }).catch(() => {
      if (current) setError('YouTube player could not open. Close the player and try again.')
    })
    return () => { current = false }
  }, [video, docked, bounds, suppressed])
  useEffect(() => () => { void window.api.youtubePlayer(null).catch(() => undefined) }, [])
  if (!video) return null
  if (!inline) return error ? <div className="youtube-player-error" role="alert">{error}</div> : null
  return createPortal(
    <section className="youtube-player youtube-player--inline"
      style={bounds} hidden={suppressed} aria-label={'Playing ' + video.title}>
      <header>
        <span title={video.title}>{video.title}</span>
        <button type="button" onClick={() => setFloating(true)} aria-label="Picture in picture" title="Picture in picture — drag its title bar to move anywhere on your desktop">▣</button>
        <button type="button" onClick={close} aria-label="Close video player" title="Close video player">×</button>
      </header>
      <div className="youtube-player-surface" ref={surface} />
      {error && <div className="youtube-player-error" role="alert">{error}</div>}
    </section>, document.body,
  )
}
