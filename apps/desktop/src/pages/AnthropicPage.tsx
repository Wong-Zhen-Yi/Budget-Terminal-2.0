import { useEffect, useState } from 'react'
import { anthropicResearch } from '@shared/anthropic'
import type { AnthropicFact, AnthropicPayload } from '@shared/anthropic'
import { useAnthropic, useRefreshAnthropic } from '@/api/anthropicQueries'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import '@/styles/anthropic.css'

const date = (value: number | null) => value === null ? 'No successful check' : new Date(value).toLocaleString()

function DemandChart({ data }: { data: AnthropicPayload }) {
  return <section className="ant-demand" aria-label="Quarterly revenue and compute costs">
    <div className="ant-chart-title"><div><span className="ant-eyebrow">The scaling question</span><h2>Revenue is outrunning compute spend</h2></div><span>USD billions · rounded</span></div>
    <div className="ant-chart-legend"><span>● Revenue</span><span>● Compute & infrastructure costs</span></div>
    <div className="ant-bars" role="img" aria-label={data.quarters.map(row => `${row.period}: revenue ${row.revenue} billion, compute ${row.compute} billion`).join('; ')}>
      {data.quarters.map(row => <div className="ant-quarter" key={row.period}>
        <div className="ant-bar-pair"><div style={{ height: `${row.revenue / 18 * 100}%` }}><span>{row.revenue.toFixed(1)}</span></div><div style={{ height: `${row.compute / 18 * 100}%` }}><span>{row.compute.toFixed(1)}</span></div></div>
        <span>{row.period}</span>
      </div>)}
    </div>
    <p>Quarterly flows, not run rates. Compute excludes other expenses; the gap is not gross profit. Source: November IPO fact sheet.</p>
  </section>
}

export function AnthropicPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const query = useAnthropic()
  const refresh = useRefreshAnthropic()
  const data = query.data?.data ?? anthropicResearch()
  const [section, setSection] = useState('business')
  const [evidence, setEvidence] = useState('factsheet')
  const [selectedFact, setSelectedFact] = useState<AnthropicFact | null>(null)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const [linkError, setLinkError] = useState('')
  const topic = data.topics.find(topic => topic.id === section)
  const source = data.sources.find(source => source.id === evidence) ?? data.sources[0]
  useEffect(() => onStatusChange([{ label: 'Anthropic public-source checks', envelope: query.data,
    error: query.error, loading: query.isPending }], 'Public Anthropic disclosures · SEC EDGAR'),
  [onStatusChange, query.data, query.error, query.isPending])
  const open = async (url: string) => {
    setLinkError('')
    try { await window.api.openExternal(url) } catch { setLinkError('Could not open source. Try again.') }
  }
  const check = async () => {
    setChecking(true); setMessage('')
    try {
      const result = await refresh()
      setMessage(result.errors.length ? 'Some sources could not be checked. See individual checks below and Settings.' : 'Public sources checked. Reviewed figures retain their original dates.')
    } catch { setMessage('Update check could not complete. Saved research remains available; see Settings for details.') }
    finally { setChecking(false) }
  }
  const fact = (item: AnthropicFact) => <button key={item.title} className={`ant-fact ${evidence === item.source ? 'ant-evidence-selected' : ''}`}
    onClick={() => { setEvidence(item.source); setSelectedFact(item); setLinkError('') }} aria-label={`Inspect source for ${item.title}`}>
    <span className="ant-eyebrow">{item.title}</span><strong>{item.value}</strong><p>{item.detail}</p><span className="ant-fact-link">Inspect evidence ↗</span>
  </button>
  return <div className="anthropic-page" data-anthropic-page>
    <header className="ant-header">
      <div className="ant-brand-mark" aria-hidden="true">A<span>Ⅰ</span></div>
      <div><div className="ant-eyebrow">Focus / private company research</div><h1>Anthropic</h1><p>Claude, capital and the economics of frontier intelligence</p></div>
      <div className="ant-identity"><strong>Private · proposed IPO</strong><span>Reviewed {data.reviewedAt}</span><span>No public quote supplied</span></div>
    </header>
    <div className="ant-workspace">
      <nav className="ant-index" aria-label="Anthropic research sections">
        <span className="ant-eyebrow">Research questions</span>
        {data.topics.map((item, index) => <button key={item.id} aria-pressed={section === item.id} onClick={() => { setSection(item.id); setEvidence(item.facts[0].source); setSelectedFact(null) }}>
          <span>0{index + 1}</span>{item.title}
        </button>)}
        <button className="ant-update-tab" aria-pressed={section === 'updates'} onClick={() => setSection('updates')}><span>06</span>Updates & sources {data.reviewReasons.length > 0 && <i aria-label="Research review needed" />}</button>
        <div className="ant-review-note"><span className="ant-eyebrow">Living dossier</span><p>Next research review<br /><strong>{data.nextReviewAt}</strong></p><p>Official sources checked every 6 hours while the app is open.</p></div>
      </nav>
      <main className="ant-research">
        <div className="ant-section-heading"><span className="ant-eyebrow">{topic?.title ?? 'Evidence watch'}</span><h2>{topic?.question ?? 'What changed since the last review?'}</h2></div>
        {section === 'business' ? <div className="ant-business">
          <DemandChart data={data} />
          <div className="ant-adoption">{[topic!.facts[2], topic!.facts[3], topic!.facts[4]].map(fact)}</div>
          <div className="ant-company-brief"><strong>Research-led AI company</strong><p>Dario Amodei, CEO · Daniela Amodei, President. Claude reaches customers through direct products, developer usage and cloud partners. Public benefit corporation with a Long-Term Benefit Trust.</p><button onClick={() => setEvidence('company')}>Company & governance ↗</button></div>
        </div> : section === 'updates' ? <div className="ant-updates">
          <div className="ant-update-controls"><div><strong>{data.reviewReasons.length ? 'Research review needed' : 'Research review schedule'}</strong><p>Facts reviewed {data.reviewedAt}; next review {data.nextReviewAt}. A source check does not revalidate financial figures.</p></div><Button onClick={() => void check()} disabled={checking}>{checking ? 'Checking sources…' : 'Check for updates'}</Button></div>
          {message && <p role="status" className="ant-inline-message">{message}</p>}
          {data.reviewReasons.length > 0 && <ul className="ant-review-reasons">{data.reviewReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
          <div className="ant-checks">{data.checks.length ? data.checks.map(check => <div key={check.id}><strong>{check.id}</strong><span>{check.error ? 'Check unavailable' : check.changed ? 'Content changed' : 'Checked'}</span><small>{date(check.checkedAt)}</small>{check.error && <p>{check.error}</p>}</div>) : <p>{query.isPending ? 'Checking public sources…' : 'Source checks are unavailable. Reviewed research remains available.'}</p>}</div>
          <div className="ant-feeds"><section><h3>Official announcements <span>{data.announcements.length}</span></h3><div className="ant-feed-scroll">{data.announcements.map(row => <button key={row.url} onClick={() => void open(row.url)}><time>{row.date}</time><span>{row.title}</span><span>↗</span></button>)}{!data.announcements.length && <p>No live announcements available.</p>}</div></section>
            <section><h3>SEC filing watch <span>{data.filings.length}</span></h3><div className="ant-feed-scroll">{data.filings.map(row => <button key={row.accessionNumber} onClick={() => void open(row.documentUrl)}><time>{row.filedDate}</time><span>{row.form}<small>{row.description || row.accessionNumber}</small></span><span>↗</span></button>)}{!data.filings.length && <p>No live filings available. Use the reviewed S-1 source.</p>}</div></section></div>
        </div> : <>
          {section === 'capital' && <div className="ant-funding-history" aria-label="Private funding history">{data.fundingRounds.map(row => <button key={row.round} onClick={() => { setEvidence(row.source); setSelectedFact(null) }} aria-label={`Inspect ${row.round} funding source`}><small>{row.date}</small><span>{row.round}</span><strong>${row.valuation}B</strong><small>Post-money · ${row.raised}B raised</small></button>)}</div>}
          <div className="ant-topic-facts">{topic?.facts.map(fact)}</div>
        </>}
      </main>
      <aside className="ant-evidence" aria-label="Research evidence">
        <span className="ant-eyebrow">Evidence desk</span><h2>Follow the disclosure</h2>
        {selectedFact && <div className="ant-selected-fact"><strong>{selectedFact.title}</strong><p>{selectedFact.detail}</p></div>}
        <div className="ant-source-detail"><span>FIRST-PARTY SOURCE</span><h3>{source.title}</h3><p>{source.publishedAt}</p><Button onClick={() => void open(source.url)}>Open original source ↗</Button></div>
        {linkError && <p role="alert">{linkError}</p>}
        <div className="ant-source-list" aria-label="Reviewed sources">{data.sources.map(item => <button key={item.id} aria-pressed={evidence === item.id} onClick={() => { setEvidence(item.id); setSelectedFact(null); setLinkError('') }}><span>{item.title}</span><small>{item.publishedAt}</small></button>)}</div>
        <p className="ant-method">Company disclosures and unaudited interim figures retain their stated periods. Questions and risks are research judgments. Funding valuation, run-rate revenue and recognized revenue measure different things.</p>
      </aside>
    </div>
  </div>
}
