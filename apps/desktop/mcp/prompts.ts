import type { GetPromptResult, Prompt } from '@modelcontextprotocol/sdk/types.js'
import { McpError } from './errors.js'

/**
 * Reusable research prompts. Clients such as Claude Code list them as slash commands.
 * They only describe which existing tools to call: no extra permissions or bridge access.
 */
interface PromptDefinition {
  prompt: Prompt
  validate: Record<string, RegExp>
  render: (args: Record<string, string>) => string
}

const evidence = 'Keep sources, as-of times, freshness and partial-data warnings visible. Do not edit saved records unless I ask.'
const definitions: PromptDefinition[] = [
  {
    prompt: { name: 'company_research', title: 'Company research', description: 'Research one company with labelled prices, fundamentals, refreshed news and a chart.',
      arguments: [{ name: 'symbol', description: 'Ticker symbol, for example AAPL', required: true }] },
    validate: { symbol: /^[A-Za-z0-9.^=-]{1,24}$/ },
    render: ({ symbol }) => `Research ${symbol.toUpperCase()} with Budget Terminal. Start with budget_terminal_company_overview using { "request": { "symbol": "${symbol.toUpperCase()}" } }. Then use budget_terminal_charts_history for the 6M trend and budget_terminal_targets for analyst targets. Summarize price action, fundamentals, catalysts from the news and key risks. ${evidence}`,
  },
  {
    prompt: { name: 'portfolio_review', title: 'Portfolio review', description: 'Review a saved portfolio with current prices, refreshed news and risk notes.',
      arguments: [{ name: 'portfolioId', description: 'Saved portfolio ID. Leave blank to list portfolios first.', required: false }] },
    validate: { portfolioId: /^[A-Za-z0-9_-]{1,100}$/ },
    render: ({ portfolioId }) => `${portfolioId ? `Review saved portfolio ${portfolioId}.` : 'Read my saved portfolios with budget_terminal_portfolio and ask which one to review if there is more than one.'} Use budget_terminal_portfolio_briefing with the portfolio ID for labelled prices and refreshed news, then budget_terminal_analytics for portfolio metrics. Highlight concentration, the biggest movers, material news and options nearing expiry. ${evidence}`,
  },
  {
    prompt: { name: 'market_brief', title: 'Market brief', description: 'Summarize global markets, macro releases and top headlines.', arguments: [] },
    validate: {},
    render: () => `Write a concise market brief with Budget Terminal. Use budget_terminal_global_markets for indexes, budget_terminal_economic for recent macro drivers, budget_terminal_calendar_month for upcoming releases and budget_terminal_news_page with response.mode summary for headlines. ${evidence}`,
  },
  {
    prompt: { name: 'page_screenshot', title: 'Page screenshot', description: 'Capture a Budget Terminal page and describe what it shows.',
      arguments: [{ name: 'page', description: 'Page ID such as charts, portfolio or focus-dashboard. Defaults to the current page.', required: false }] },
    validate: { page: /^[a-z][a-z0-9-]{0,79}$/ },
    render: ({ page }) => `Capture ${page ? `the ${page} page` : 'the current page'} with budget_terminal_screenshot using { "request": { "page": "${page || 'current'}" } }. Describe what it shows, including any loading or error state in the page metadata. Privacy blur is intentional: do not try to reveal obscured values.`,
  },
]

export const prompts: Prompt[] = definitions.map(definition => definition.prompt)

export function getPrompt(name: string, args: Record<string, string> = {}): GetPromptResult {
  const definition = definitions.find(entry => entry.prompt.name === name)
  if (!definition) throw new McpError('Unknown Budget Terminal prompt', 'UNKNOWN_TOOL')
  const values: Record<string, string> = {}
  for (const argument of definition.prompt.arguments ?? []) {
    const value = String(args[argument.name] ?? '').trim()
    if (!value) {
      if (argument.required) throw new McpError(`Prompt argument ${argument.name} is required.`, 'INVALID_ARGUMENTS')
      values[argument.name] = ''
      continue
    }
    if (!definition.validate[argument.name]?.test(value)) throw new McpError(`Invalid prompt argument ${argument.name}.`, 'INVALID_ARGUMENTS')
    values[argument.name] = value
  }
  return { description: definition.prompt.description, messages: [{ role: 'user', content: { type: 'text', text: definition.render(values) } }] }
}
