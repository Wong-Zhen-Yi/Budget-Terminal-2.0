import { memo } from 'react'
import type { AgentImage, AgentMessage } from '@shared/agents'
import { AgentChatImage } from './AgentChatImage'
import { AgentMarkdown } from './AgentMarkdown'

interface MessageProps {
  message: AgentMessage
  imagesLocked: boolean
  onUseImage: (image: AgentImage) => void
}

const Message = memo(function Message({ message, imagesLocked, onUseImage }: MessageProps) {
  return <article className={`agents-message ${message.role}`} aria-label={message.role === 'assistant' ? 'Codex response' : message.role === 'user' ? 'Your message' : 'Agent activity'}>
    <div className="agents-message-meta">{message.role === 'assistant' ? 'Codex' : message.role === 'user' ? 'You' : 'Activity'} <time dateTime={new Date(message.at).toISOString()}>{new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
    {message.role === 'assistant' ? <AgentMarkdown text={message.text} /> : <p className="agents-plain-message">{message.text}</p>}
    {message.imageStatus === 'generating' && <p className="agents-thinking" role="status">Creating image… This can take a few minutes.</p>}
    {message.imageArtifacts?.map(artifact => <AgentChatImage key={artifact.id} artifact={artifact} locked={imagesLocked} onUse={onUseImage} />)}
    {message.images?.filter(name => !message.imageArtifacts?.some(artifact => artifact.name === name)).map((name, index) => <span className="agents-image-name" key={index}>Attached image: {name}</span>)}
  </article>
})

// Polls and composer edits should not reconcile the entire conversation.
export const AgentMessages = memo(function AgentMessages({ messages, imagesLocked, onUseImage }: {
  messages: AgentMessage[]
  imagesLocked: boolean
  onUseImage: (image: AgentImage) => void
}) {
  return <>{messages.map(message => <Message key={message.id} message={message} imagesLocked={imagesLocked} onUseImage={onUseImage} />)}</>
})
