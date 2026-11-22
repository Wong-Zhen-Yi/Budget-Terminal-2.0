import { useState } from 'react'

import type { TABS } from '@shared/contract'
import { focusTopicPages } from '@shared/navigation'
import { NavigationIcon } from '@/components/chrome/NavigationIcon'
import { FocusCardMetrics } from '@/components/focus/FocusCardMetrics'
import './FocusDashboardPage.css'

const filters = [
  { id: 'all', label: 'All pages' },
  { id: 'companies', label: 'Companies' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'digital-assets', label: 'Digital assets' },
  { id: 'macro', label: 'Macro & commodities' },
] as const

type Filter = (typeof filters)[number]['id']

const topics: Record<string, { category: Exclude<Filter, 'all'>; summary: string; keywords?: string }> = {
  amzn: { category: 'companies', summary: 'Amazon · AWS & retail' },
  anthropic: { category: 'companies', summary: 'Claude, funding & compute', keywords: 'ANT AI' },
  avgo: { category: 'companies', summary: 'Broadcom · Chips & software' },
  googl: { category: 'companies', summary: 'Alphabet · Search & cloud', keywords: 'Google' },
  hims: { category: 'companies', summary: 'Hims & Hers · Telehealth' },
  hood: { category: 'companies', summary: 'Robinhood · Trading & assets' },
  mu: { category: 'companies', summary: 'Micron · Memory & storage' },
  nvda: { category: 'companies', summary: 'NVIDIA · AI infrastructure', keywords: 'GPU' },
  pltr: { category: 'companies', summary: 'Palantir · AI & government' },
  sofi: { category: 'companies', summary: 'Lending & digital banking' },
  vst: { category: 'companies', summary: 'Vistra · Power & demand' },
  homebuilders: { category: 'sectors', summary: 'Housing, builders & mortgages' },
  semiconductors: { category: 'sectors', summary: 'Chipmakers & supply chain' },
  bitcoin: { category: 'digital-assets', summary: 'Price, supply & on-chain activity', keywords: 'BTC' },
  bmnr: { category: 'digital-assets', summary: 'BitMine · Ethereum treasury', keywords: 'ETH' },
  eth: { category: 'digital-assets', summary: 'Network, supply & staking', keywords: 'ETH' },
  gold: { category: 'macro', summary: 'Bullion, yields & the dollar' },
  macro: { category: 'macro', summary: 'Growth, inflation & rates' },
  oil: { category: 'macro', summary: 'Crude, inventories & demand', keywords: 'WTI Brent' },
}

export function FocusDashboardPage({ tabs, onSelectTab, obscuredPages }: {
  tabs: typeof TABS
  onSelectTab: (id: string) => void
  obscuredPages?: readonly string[]
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const pages = focusTopicPages(tabs).filter(tab => {
    const topic = topics[tab.id]
    if (filter !== 'all' && topic?.category !== filter) return false
    const text = [tab.id, tab.label, topic?.summary, topic?.keywords].join(' ').toLowerCase()
    return terms.every(term => text.includes(term))
  })

  return (
    <div className="focus-dashboard">
      <div className="focus-dashboard__toolbar">
        <div className="focus-dashboard__filters" role="group" aria-label="Filter Focus pages">
          {filters.map(option => (
            <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
        <label className="focus-dashboard__search">
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8.5" cy="8.5" r="4.75" />
            <path d="m12 12 4 4" />
          </svg>
          <input type="search" aria-label="Search Focus pages" placeholder="Search topics or tickers"
            value={query} onChange={event => setQuery(event.target.value)} />
        </label>
      </div>

      <p className="sr-only" role="status">{pages.length} {pages.length === 1 ? 'page' : 'pages'} available</p>
      {pages.length ? (
        <nav aria-label="Focus pages" className="focus-dashboard__grid">
          {pages.map(tab => (
            <button type="button" key={tab.id} className="focus-dashboard__card"
              aria-label={tab.label} aria-describedby={`focus-topic-${tab.id} focus-metric-${tab.id}`}
              onClick={() => onSelectTab(tab.id)}>
              <span className="focus-dashboard__card-heading">
                <span className="focus-dashboard__icon"><NavigationIcon id={tab.id} /></span>
                <span className="focus-dashboard__topic">
                  <strong>{tab.label}</strong>
                  {topics[tab.id] && <span className="focus-dashboard__summary" id={`focus-topic-${tab.id}`}>{topics[tab.id].summary}</span>}
                </span>
              </span>
              <FocusCardMetrics page={tab.id} obscured={obscuredPages?.includes(tab.id) ?? false} />
              <span className="focus-dashboard__arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </nav>
      ) : (
        <div className="focus-dashboard__empty">
          <p>{query || filter !== 'all' ? 'No matching Focus pages.' : 'No Focus pages are visible.'}</p>
          {query || filter !== 'all' ? (
            <button type="button" onClick={() => { setQuery(''); setFilter('all') }}>Clear filters</button>
          ) : null}
        </div>
      )}
    </div>
  )
}
