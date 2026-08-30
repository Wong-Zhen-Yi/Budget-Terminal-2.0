import type {
  InstitutionActivityPayload,
  InstitutionActivityRow,
  InstitutionManagerRow,
} from './contract.js'

function exportValue(value: unknown): string {
  const text = Array.isArray(value)
    ? value.map((item) => String(item ?? '')).filter(Boolean).join(', ')
    : String(value ?? '')
  return text.replaceAll('|', '/').replace(/[\r\n]+/g, ' ').trim()
}

function appendRows<T>(
  lines: string[],
  title: string,
  rows: T[],
  columns: Array<{ label: string; value: (row: T) => unknown }>,
): void {
  lines.push('', `## ${title}`)
  lines.push(columns.map((column) => column.label).join(' | '))
  lines.push(columns.map(() => '---').join(' | '))
  if (!rows.length) {
    lines.push(['(no loaded rows)', ...columns.slice(1).map(() => '')].join(' | '))
    return
  }
  for (const row of rows) {
    lines.push(columns.map((column) => exportValue(column.value(row))).join(' | '))
  }
}

const ACTIVITY_COLUMNS: Array<{
  label: string
  value: (row: InstitutionActivityRow) => unknown
}> = [
  { label: 'period', value: (row) => row.period },
  { label: 'symbol', value: (row) => row.symbol },
  { label: 'company', value: (row) => row.company },
  { label: 'manager', value: (row) => row.manager },
  { label: 'activity', value: (row) => row.activity },
  { label: 'share_change', value: (row) => row.shareChange },
  { label: 'approx_flow', value: (row) => row.approxFlow },
  { label: 'hold_price', value: (row) => row.holdPrice },
  { label: 'change_to_portfolio', value: (row) => row.changeToPortfolio },
  { label: 'source_url', value: (row) => row.sourceUrl },
]

export function institutionActivityClipboard(
  payload: InstitutionActivityPayload,
  generatedAt = new Date(),
): string {
  const lines = [
    '# Institutions Buys/Sells Export',
    `Generated: ${generatedAt.toISOString().slice(0, 19)}`,
    `Active quarter: ${payload.activePeriod || 'N/A'}`,
    '',
    'Approximate dollar flow uses share change multiplied by DATAROMA Hold Price. It is not an exact execution-dollar figure.',
    '',
  ]
  appendRows(lines, 'Top Institutional Buying', payload.buyRows, ACTIVITY_COLUMNS)
  appendRows(lines, 'Top Institutional Selling', payload.sellRows, ACTIVITY_COLUMNS)
  return `${lines.join('\n').trim()}\n`
}

export function institutionManagersClipboard(
  payload: InstitutionActivityPayload,
  generatedAt = new Date(),
): string {
  const lines = [
    '# Institutions Superinvestors Export',
    `Generated: ${generatedAt.toISOString().slice(0, 19)}`,
    `Active quarter: ${payload.activePeriod || 'N/A'}`,
    '',
  ]
  appendRows<InstitutionManagerRow>(lines, 'Superinvestors', payload.managerRows, [
    { label: 'manager', value: (row) => row.manager },
    { label: 'id', value: (row) => row.managerId },
    { label: 'period', value: (row) => row.period },
    { label: 'buys', value: (row) => row.buyCount },
    { label: 'sells', value: (row) => row.sellCount },
    { label: 'top_activity', value: (row) => row.topActivity },
    { label: 'source_url', value: (row) => row.sourceUrl },
  ])
  return `${lines.join('\n').trim()}\n`
}

export function formatInstitutionMoney(value: number): string {
  const absolute = Math.abs(Number.isFinite(value) ? value : 0)
  if (absolute >= 1_000_000_000) return `$${(absolute / 1_000_000_000).toFixed(2)}B`
  if (absolute >= 1_000_000) return `$${(absolute / 1_000_000).toFixed(2)}M`
  if (absolute >= 1_000) return `$${(absolute / 1_000).toFixed(1)}K`
  return `$${absolute.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
