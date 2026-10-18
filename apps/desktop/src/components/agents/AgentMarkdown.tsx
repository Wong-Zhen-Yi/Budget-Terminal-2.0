import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Keep model output as React elements. Never interpret raw HTML or load remote images.
export function AgentMarkdown({ text }: { text: string }) {
  return <div className="agents-prose"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => {
      if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>
      return <a href={href} onClick={event => { event.preventDefault(); void window.api.openExternal(href) }}>{children}</a>
    },
    img: ({ alt }) => <span className="agents-image-name">{alt || 'Image'}</span>,
    table: ({ children }) => <div className="agents-prose-table" tabIndex={0} role="region" aria-label="Response table"><table>{children}</table></div>,
  }}>{text}</Markdown></div>
}
