export const agentQuickPrompts = [
  {
    label: 'Summarize portfolio news',
    prompt: `Give me up to 3 important news items from the last 24 hours for my saved portfolio's 5 largest holdings (first 5 if values are unavailable). Include ticker, why it matters, and dated sources. Keep the answer under 150 words.

Use only built-in read-only portfolio/news tools. Do not use the browser or web search. Prefer cached/batched data; make at most 6 tool calls total, including reading holdings. No retries or extra research. Aim to finish within 2 minutes; return partial results and note missing/stale data instead of waiting. Don't invent facts. If no holdings are saved, ask me which tickers to cover.`,
  },
  {
    label: 'Brief me on my portfolio for the day',
    prompt: `Give me a quick daily portfolio brief: value and daily change if already available, up to 3 notable movers/news items among my 5 largest holdings (first 5 if values are unavailable), and one thing to watch today. Cite dated sources and keep the answer under 150 words. Don't calculate missing metrics.

Use only built-in read-only portfolio/market/news tools. Do not use the browser or web search. Prefer cached/batched data; make at most 6 tool calls total, including reading holdings. No retries or extra research. Aim to finish within 2 minutes; return partial results and note missing/stale data instead of waiting. Don't invent facts. If no holdings are saved, ask me which tickers to cover.`,
  },
] as const
