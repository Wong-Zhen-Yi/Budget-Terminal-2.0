import { effectiveFreshness, useSnapshotClock } from '@/api/snapshotHealth'
import { FRESHNESS } from '@shared/freshness'
import { useEffect, useState } from 'react'
import { bitcoinCycle } from '@shared/bitcoin'
import { useBitcoin, useRefreshBitcoin } from '@/api/bitcoinQueries'
import { api } from '@/api/client'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'

const fmt = (value: number | null | undefined, digits = 0) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: digits })
const stamp = (value: number | undefined) => value ? new Date(value).toLocaleString() : 'Unavailable'

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return <dl className="p-2">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b border-border/50 py-2 text-xs"><dt className="text-text-muted">{label}</dt><dd className="num text-right font-semibold">{value}</dd></div>)}</dl>
}

export function BitcoinPage({ onStatusChange }: { onStatusChange: (panels: PanelStatus[], sourcePath: string) => void }) {
  const query = useBitcoin()
  const now = useSnapshotClock()
  const freshness = query.data ? effectiveFreshness(query.data, now, FRESHNESS.bitcoin) : 'unavailable'
  const refresh = useRefreshBitcoin()
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')
  const data = query.data?.data
  const stats = data?.stats
  const tip = data?.blocks[0]
  const cycle = tip ? bitcoinCycle(tip.height) : null
  const busy = refreshing || query.isFetching
  useEffect(() => onStatusChange([{ label: 'Bitcoin', envelope: query.data, error: query.error, enabled: query.isEnabled, loading: busy }], ''), [query.data, busy, onStatusChange])
  const onRefresh = async () => {
    setRefreshing(true)
    setNotice('')
    try { await refresh() } catch (error) { setNotice(String(error)) } finally { setRefreshing(false) }
  }
  const feeRows: Array<[string, string]> = [
    ['Next block', fmt(data?.fees?.fastestFee, 2)],
    ['~30 minutes', fmt(data?.fees?.halfHourFee, 2)],
    ['~1 hour', fmt(data?.fees?.hourFee, 2)],
    ['Economy', fmt(data?.fees?.economyFee, 2)],
    ['Minimum relay estimate', fmt(data?.fees?.minimumFee, 2)],
  ]
  const tiles = [
    ['BTC / USD', stats ? `$${fmt(stats.market_price_usd, 2)}` : '—', 'Blockchain.com spot reference'],
    ['Blocks mined · 24h', fmt(stats?.n_blocks_mined), 'Target pace ≈ 144 blocks / day'],
    ['Latest block height', fmt(tip?.height), 'mempool.space chain tip'],
    ['Hash rate · 24h estimate', stats ? `${fmt(stats.hash_rate / 1e9, 2)} EH/s` : '—', 'Estimated from mined blocks'],
    ['Block subsidy', cycle ? `${fmt(cycle.subsidy, 8)} BTC` : '—', 'New BTC per block · excludes fees'],
    ['Unconfirmed transactions', fmt(data?.mempool?.count), 'mempool.space node view'],
  ]
  return <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="text-sm font-semibold">Bitcoin — network & mining</h1>
      <span className="ml-auto text-2xs text-text-muted">{busy ? 'Loading Bitcoin network data…' : `${freshness} · fetched ${stamp(query.data?.meta.fetchedAt)}`}</span>
      <Button variant="accent" disabled={busy} onClick={onRefresh}>{busy ? 'Refreshing…' : 'Refresh'}</Button>
    </div>
    {(notice || query.error || query.data?.errors.length) ? <div role="status" className="border border-warn/40 bg-surface p-2 text-xs text-warn">{notice || query.error?.message || query.data?.meta.failureReason}</div> : null}
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">{tiles.map(([label, value, sub]) => <div key={label} className="border border-border bg-surface p-3 text-center"><div className="text-2xs text-text-muted">{label}</div><div className="num my-1 text-lg font-bold">{value}</div><div className="text-2xs text-text-muted">{sub}</div></div>)}</div>
    <div className="grid gap-2 lg:grid-cols-3">
      <Panel title="Mining activity · trailing 24 hours">
        <Rows rows={[
          ['Blocks vs daily target', stats ? `${fmt(stats.n_blocks_mined / 144 * 100, 1)}%` : '—'],
          ['Average block interval', stats ? `${fmt(stats.minutes_between_blocks, 2)} min` : '—'],
          ['BTC mined (subsidy)', stats ? `${fmt(stats.n_btc_mined / 1e8, 4)} BTC` : '—'],
          ['Confirmed transactions', fmt(stats?.n_tx)],
          ['Transactions / second', stats ? fmt(stats.n_tx / 86400, 2) : '—'],
          ['Difficulty', tip ? `${fmt(tip.difficulty / 1e12, 2)} T` : '—'],
        ]} />
        <p className="mt-auto p-2 text-2xs text-text-muted">Blockchain.com statistics as of {stamp(stats?.timestamp)}. Difficulty from the latest mempool.space block.</p>
      </Panel>
      <Panel title="Issuance & halving countdown">
        <Rows rows={[
          ['Issued supply (reported)', stats ? `${fmt(stats.totalbc / 1e8, 2)} BTC` : '—'],
          ['Share of 21M ceiling', stats ? `${fmt(stats.totalbc / 1e8 / 21e6 * 100, 3)}%` : '—'],
          ['Next halving height', fmt(cycle?.nextHalving)],
          ['Blocks until halving', fmt(cycle?.remaining)],
          ['Time at 10 min / block', cycle ? `≈ ${fmt(cycle.remaining * 10 / 1440)} days` : '—'],
          ['Next difficulty adjustment', cycle && tip ? `${fmt(cycle.nextRetarget - tip.height)} blocks` : '—'],
        ]} />
        <div className="px-2 pb-2"><div className="mb-1 flex justify-between text-2xs text-text-muted"><span>Halving epoch progress</span><span>{fmt(cycle?.progress, 2)}%</span></div><div role="progressbar" aria-label="Halving epoch progress" aria-valuenow={cycle?.progress} aria-valuemin={0} aria-valuemax={100} className="h-2 bg-surface-raised"><div className="h-2 bg-amber-500" style={{ width: `${cycle?.progress ?? 0}%` }} /></div></div>
        <p className="p-2 text-2xs text-text-muted">Countdown uses the protocol target, not a guaranteed date. Issued supply includes lost coins.</p>
      </Panel>
      <Panel title="Transaction fees · sat/vB">
        <Rows rows={feeRows} />
        <Rows rows={[
          ['Mempool virtual size', data?.mempool ? `${fmt(data.mempool.vsize / 1e6, 2)} MvB` : '—'],
          ['Queued transaction fees', data?.mempool ? `${fmt(data.mempool.total_fee / 1e8, 4)} BTC` : '—'],
        ]} />
        <p className="mt-auto p-2 text-2xs text-text-muted">mempool.space estimates; confirmation times vary. 1 satoshi = 0.00000001 BTC.</p>
      </Panel>
    </div>
    <Panel title="Recently mined blocks" className="min-h-[260px] flex-1">
      <div className="overflow-auto"><table className="w-full text-xs"><thead className="sticky top-0 bg-surface-raised text-left text-text-muted"><tr>{['Height', 'Mined (local time)', 'Transactions', 'Size (MB)', 'Block weight used'].map(label => <th key={label} className="p-2 font-normal">{label}</th>)}</tr></thead><tbody>{data?.blocks.map(block => <tr key={block.id} className="border-t border-border/50 hover:bg-surface-raised"><td className="num p-2"><button className="text-accent hover:underline" onClick={() => { void api.openExternal(`https://mempool.space/block/${block.id}`) }}>{fmt(block.height)}</button></td><td className="p-2">{stamp(block.timestamp * 1000)}</td><td className="num p-2">{fmt(block.tx_count)}</td><td className="num p-2">{fmt(block.size / 1e6, 3)}</td><td className="p-2"><div className="flex items-center gap-2"><div className="h-1.5 w-24 bg-surface-raised"><div className="h-1.5 bg-amber-500/80" style={{ width: `${Math.min(100, block.weight / 4e6 * 100)}%` }} /></div><span className="num">{fmt(block.weight / 4e6 * 100, 1)}%</span></div></td></tr>)}</tbody></table>{!data?.blocks.length && <p className="p-6 text-center text-text-muted">{busy ? 'Loading recently mined blocks…' : 'Recent blocks unavailable. Use Refresh to retry.'}</p>}</div>
    </Panel>
    <footer className="flex flex-wrap gap-2 text-2xs text-text-muted"><span>Free public data · no API keys · 60-second cache · refresh on demand.</span><button className="hover:underline" onClick={() => { void api.openExternal('https://www.blockchain.com/explorer/api/charts_api') }}>Blockchain.com API ↗</button><button className="hover:underline" onClick={() => { void api.openExternal('https://mempool.space/docs/api/rest') }}>mempool.space API ↗</button></footer>
  </div>
}
