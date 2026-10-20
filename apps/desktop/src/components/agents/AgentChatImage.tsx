import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentImageArtifact } from '@shared/agentImageArtifacts'
import type { AgentImage } from '@shared/agents'
import { api } from '@/api/client'

export function AgentChatImage({ artifact, locked, onUse }: {
  artifact: AgentImageArtifact
  locked: boolean
  onUse: (image: AgentImage) => void
}) {
  const host = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  const [broken, setBroken] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '300px' })
    if (host.current) observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  const query = useQuery({
    queryKey: ['agentImages', artifact.id], enabled: visible, staleTime: Infinity, gcTime: 5 * 60_000, retry: false, refetchOnMount: true,
    queryFn: async () => {
      const result = await api.agentsImage(artifact.id)
      if (result.errors.length || !result.data) throw new Error(result.errors.map(error => error.reason).join(' · ') || 'Image unavailable.')
      if (result.data.dataUrl.length > 12_000_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(result.data.dataUrl)) throw new Error('Unsupported chat image format.')
      return result.data
    },
  })
  const image = query.data
  return <figure ref={host} className={`agents-chat-image${expanded ? ' expanded' : ''}`} aria-label={`${artifact.kind === 'generated' ? 'Generated' : 'Uploaded'} image: ${artifact.name}`}>
    {query.error || broken ? <p role="status">Image unavailable. Reopen this chat or attach the image again.</p>
      : image ? <img src={image.dataUrl} alt={artifact.name} onError={() => setBroken(true)} />
        : <p role="status">Loading image…</p>}
    <figcaption>{artifact.kind === 'generated' ? 'AI-generated image' : 'Attached image'} · {artifact.name}</figcaption>
    {image && !broken && <div className="agents-chat-image-actions">
      <button type="button" disabled={locked} onClick={() => onUse(image)}>Use for edit</button>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Fit image' : 'Expand image'}</button>
    </div>}
  </figure>
}
