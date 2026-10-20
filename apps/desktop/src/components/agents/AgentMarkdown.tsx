import { isValidElement, memo } from 'react'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AGENT_CANDLESTICK_LANGUAGE, AGENT_PIE_LANGUAGE, parseAgentCandlestick, parseAgentPie } from '@shared/agentCharts'
import { AgentCandlestickChart } from './AgentCandlestickChart'
import { AgentPieChart } from './AgentPieChart'

// Stable renderer types keep chart controls/zoom intact during polling and streamed replies.
// Keep model output as React elements. Never interpret raw HTML or load remote images.
const components: Components = {
  pre: ({ children }) => {
    if (isValidElement<{ className?: string; children?: ReactNode }>(children)
      && typeof children.props.children === 'string') {
      if (children.props.className === `language-${AGENT_CANDLESTICK_LANGUAGE}`) {
        const chart = parseAgentCandlestick(children.props.children)
        if (chart) return <AgentCandlestickChart chart={chart} />
        return <div className="agents-candlestick-error" role="status">
          <p>Candlestick chart unavailable: the data is incomplete or invalid. Expected a title and market symbol, or valid legacy chronological OHLC data.</p>
          <details><summary>Show chart data</summary><pre>{children}</pre></details>
        </div>
      }
      if (children.props.className !== `language-${AGENT_PIE_LANGUAGE}`) return <pre>{children}</pre>
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
}

export const AgentMarkdown = memo(function AgentMarkdown({ text }: { text: string }) {
  return <div className="agents-prose"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>{text}</Markdown></div>
})
