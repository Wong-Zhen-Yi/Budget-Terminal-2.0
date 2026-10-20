import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { AGENT_CANDLESTICK_LANGUAGE, parseAgentCandlestick } from '@shared/agentCharts'

const parser = unified().use(remarkParse).use(remarkGfm)
interface MarkdownNode { type: string; lang?: string | null; value?: string; children?: MarkdownNode[] }

/** Match the renderer's Markdown grammar, including quoted/listed/tilde fences. */
export function agentChartSymbols(messages: readonly { role: string; text: string }[]): string[] {
  const symbols = new Set<string>()
  function visit(node: MarkdownNode) {
    if (node.type === 'code' && node.lang === AGENT_CANDLESTICK_LANGUAGE && node.value) {
      const chart = parseAgentCandlestick(node.value)
      if (chart?.symbol) symbols.add(chart.symbol)
    }
    node.children?.forEach(visit)
  }
  for (const message of messages) if (message.role === 'assistant') visit(parser.parse(message.text))
  return [...symbols]
}
