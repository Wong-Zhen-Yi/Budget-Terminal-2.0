import type { RollCandidate, RollNewsRow, RollTopOption } from '@shared/contract'
import { ROLL_PATTERN_LABELS, rollCandidateReasonText, type RollPatternMode } from '@shared/roll'
import type { RollHistoryRow } from '@/stores/roll'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EM_DASH, integer, newsTime } from '@/lib/format'

/** `_p18_format_score`. */
function score(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? 'N/A' : value.toFixed(1)
}

/** `_p18_format_signed_percent_value`. */
function signedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

/** `_p18_format_option_number`. */
function optionNumber(value: number | null | undefined, places = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A'
  return value.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places })
}

/** `_p18_format_iv`: the chain's decimal fraction, printed as a percentage. */
function impliedVolatility(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A'
  return `${(value * 100).toFixed(1)}%`
}

function tierLabel(tier: string): string {
  return { strict: 'Strict', near: 'Near', fallback: 'Fallback', unavailable: 'Unavailable' }[tier] ?? 'Not classified'
}

/**
 * Scored Candidates.
 *
 * With patterns on, the Setup column carries the match tier as a suffix on the two weak
 * tiers, and its tooltip names the strictly matched modes — a row can score well on a
 * shape that never strictly matched, and the reference is careful to say so rather than
 * letting "Breakout Setup" imply a confirmed one.
 */
export function RollCandidatesTable({
  candidates,
  currentSymbol,
  patternActive,
}: {
  candidates: RollCandidate[]
  currentSymbol: string
  patternActive: boolean
}) {
  const columns: Array<Column<RollCandidate>> = [
    {
      key: 'rank',
      header: 'Rank',
      align: 'right',
      numeric: true,
      width: '52px',
      cell: (row, index) => (row.rank === 0 ? 'Selected' : integer(row.rank || index + 1)),
      sortValue: (row) => row.rank,
    },
    {
      key: 'symbol',
      header: 'Ticker',
      align: 'center',
      width: '68px',
      cell: (row) => (
        <span className={row.symbol === currentSymbol ? 'text-accent' : undefined}>{row.symbol}</span>
      ),
      sortValue: (row) => row.symbol,
    },
    {
      key: 'score',
      header: 'Score',
      align: 'right',
      numeric: true,
      width: '54px',
      cell: (row) => score(row.score),
      sortValue: (row) => row.score,
    },
    {
      key: 'pattern',
      header: 'Pattern',
      width: '150px',
      cell: (row) => {
        let setup = row.patternType === 'None' || !row.patternType ? 'Balanced' : row.patternType
        if (patternActive && (row.matchTier === 'fallback' || row.matchTier === 'unavailable')) {
          setup = `${setup} · ${tierLabel(row.matchTier)}`
        }
        const matched = row.matchedModes.length
          ? row.matchedModes.map((mode) => ROLL_PATTERN_LABELS[mode as RollPatternMode] ?? mode).join(', ')
          : 'None'
        const tooltip = patternActive
          ? `Primary pattern: ${row.patternType || 'None'}\nMatch tier: ${tierLabel(row.matchTier)}\nStrict matched modes: ${matched}`
          : undefined
        return <span title={tooltip}>{setup}</span>
      },
      sortValue: (row) => row.patternType,
    },
    {
      key: 'patternScore',
      header: 'Pattern score',
      align: 'right',
      numeric: true,
      width: '84px',
      // A pattern score is only meaningful where an evaluator actually ran and produced
      // something; an `unavailable` row would otherwise print a confident 0.0.
      cell: (row) =>
        row.matchTier !== 'unavailable' && Number.isFinite(row.patternScore) && row.patternScore > 0
          ? score(row.patternScore)
          : 'N/A',
      sortValue: (row) => row.patternScore,
    },
    {
      key: 'sector',
      header: 'Sector',
      width: '132px',
      cell: (row) => row.sector || 'N/A',
      sortValue: (row) => row.sector,
    },
    {
      key: 'day',
      header: 'Day %',
      align: 'right',
      numeric: true,
      width: '66px',
      cell: (row) => signedPercent(row.dayChangePct),
      sortValue: (row) => row.dayChangePct,
    },
    {
      key: 'year',
      header: '1Y %',
      align: 'right',
      numeric: true,
      width: '70px',
      cell: (row) => signedPercent(row.fiftyTwoWeekChangePct),
      sortValue: (row) => row.fiftyTwoWeekChangePct,
    },
    {
      key: 'volume',
      header: 'Avg Vol',
      align: 'right',
      numeric: true,
      width: '86px',
      cell: (row) => integer(row.averageVolume),
      sortValue: (row) => row.averageVolume,
    },
    {
      key: 'reason',
      header: 'Reason',
      wrap: true,
      cell: (row) => rollCandidateReasonText(row, patternActive),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={candidates}
      rowKey={(row) => row.symbol}
      layout="fixed"
      rowClassName={(row) => (row.symbol === currentSymbol ? 'bg-surface-raised' : '')}
      empty="Roll to see ranked ticker candidates."
    />
  )
}

/** Top Options By Expiration: one row per near-term expiry. */
export function RollTopOptionsTable({ rows }: { rows: RollTopOption[] }) {
  const columns: Array<Column<RollTopOption>> = [
    { key: 'expiration', header: 'Exp', align: 'center', width: '100px', cell: (row) => row.expiration || 'N/A' },
    {
      key: 'type',
      header: 'Type',
      align: 'center',
      width: '56px',
      cell: (row) => (
        <span className={row.type === 'Call' ? 'text-up' : row.type === 'Put' ? 'text-down' : undefined}>
          {row.type || 'N/A'}
        </span>
      ),
    },
    { key: 'strike', header: 'Strike', align: 'right', numeric: true, cell: (row) => optionNumber(row.strike) },
    { key: 'last', header: 'Last', align: 'right', numeric: true, cell: (row) => optionNumber(row.lastPrice) },
    { key: 'volume', header: 'Vol', align: 'right', numeric: true, width: '68px', cell: (row) => integer(row.volume) },
    { key: 'oi', header: 'OI', align: 'right', numeric: true, width: '72px', cell: (row) => integer(row.openInterest) },
    {
      key: 'iv',
      header: 'IV',
      align: 'right',
      numeric: true,
      width: '62px',
      cell: (row) => impliedVolatility(row.impliedVolatility),
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.expiration}:${row.type}:${row.strike ?? ''}`}
      layout="fixed"
      empty="Roll a stock to inspect top-volume contracts by expiration."
    />
  )
}

export function RollNewsTable({ rows, onOpen }: { rows: RollNewsRow[]; onOpen: (url: string) => void }) {
  const columns: Array<Column<RollNewsRow>> = [
    {
      key: 'time',
      header: 'Time',
      align: 'center',
      width: '58px',
      numeric: true,
      cell: (row) => (row.publishedAt ? newsTime(row.publishedAt) : EM_DASH),
    },
    { key: 'source', header: 'Source', width: '104px', cell: (row) => row.source },
    { key: 'title', header: 'Headline', wrap: true, cell: (row) => row.title },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row, index) => `${row.url || row.title}:${index}`}
      layout="fixed"
      onRowClick={(row) => row.url && onOpen(row.url)}
      empty="Roll a stock to inspect recent headlines."
    />
  )
}

/**
 * Roll History. Clicking a row reopens it: from the cached payload when it is still one
 * of the five held, and otherwise by rolling that exact symbol, which is
 * `_p18_open_history_item` and the reason `targetSymbol` exists on the request.
 */
export function RollHistoryTable({
  rows,
  currentSymbol,
  onOpen,
}: {
  rows: RollHistoryRow[]
  currentSymbol: string
  onOpen: (symbol: string) => void
}) {
  const columns: Array<Column<RollHistoryRow>> = [
    { key: 'symbol', header: 'Ticker', align: 'center', width: '68px', cell: (row) => row.symbol },
    { key: 'company', header: 'Company', wrap: true, cell: (row) => row.company || 'N/A' },
    { key: 'sector', header: 'Sector', width: '128px', cell: (row) => row.sector || 'N/A' },
    {
      key: 'rolled',
      header: 'Rolled',
      align: 'center',
      width: '58px',
      numeric: true,
      cell: (row) => (row.rolledAt ? newsTime(row.rolledAt) : EM_DASH),
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.symbol}
      layout="fixed"
      onRowClick={(row) => onOpen(row.symbol)}
      rowClassName={(row) => (row.symbol === currentSymbol ? 'bg-surface-raised' : '')}
      empty="Rolled stocks will appear here for quick revisits."
    />
  )
}
