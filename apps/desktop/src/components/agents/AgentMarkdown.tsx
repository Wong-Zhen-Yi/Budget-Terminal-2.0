import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AGENT_PIE_LANGUAGE, parseAgentPie } from '@shared/agentCharts'
import { AgentPieChart } from './AgentPieChart'

// Keep model output as React elements. Never interpret raw HTML or load remote images.
export function AgentMarkdown({ text }: { text: string }) {
  return <div className="agents-prose"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    pre: ({ children }) => {
      if (isValidElement<{ className?: string; children?: ReactNode }>(children)
        && children.props.className === `language-${AGENT_PIE_LANGUAGE}`
        && typeof children.props.children === 'string') {
        const chart = parseAgentPie(children.props.children)
        if (chart) return <AgentPieChart chart={chart} />
        return <div className="agents-pie-error" role="status">
          <p>Pie chart unavailable: the data is incomplete or invalid. Expected 1–30 nonnegative values with a positive total.</p>
          <details><summary>Show chart data</summary><pre>{children}</pre></details>
        </div>
      }
      return <pre>{children}</pre>
    },
    a: ({ href, children }) => {
      if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>
      return <a href={href} onClick={event => { event.preventDefault(); void window.api.openExternal(href) }}>{children}</a>
    },
    img: ({ alt }) => <span className="agents-image-name">{alt || 'Image'}</span>,
    table: ({ children }) => <div className="agents-prose-table" tabIndex={0} role="region" aria-label="Response table"><table>{children}</table></div>,
  }}>{text}</Markdown></div>
}
