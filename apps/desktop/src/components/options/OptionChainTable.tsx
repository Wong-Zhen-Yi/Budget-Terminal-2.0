import type { OptionsChainRow } from '@shared/contract'
import type { StrategyDetail } from '@shared/optionsPage'
import { CHAIN_COLUMNS, formatChainValue, strategyTooltip } from '@shared/optionsPage'
import { strategyBackground } from './highlights'

/**
 * One side of the chain (`_make_chain_table` plus `build_chain_rows`).
 *
 * Chg is tinted by its own sign and IV is muted; a strike that the strategy ranked
 * gets `  #1` appended to its own cell, the whole row tinted by rank, and the ranking
 * breakdown as its tooltip — the reference puts the same text on every cell of the row,
 * so hovering anywhere in it explains the pick.
 */
export function OptionChainTable({
  rows,
  ranks,
  empty,
}: {
  rows: OptionsChainRow[]
  ranks: ReadonlyMap<number, StrategyDetail>
  empty: string
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-2xs">
        <thead className="sticky top-0 z-10 bg-surface-raised">
          <tr>
            {CHAIN_COLUMNS.map((column) => (
              <th
                key={column.label}
                className="border-b border-border px-1 py-0.5 text-right font-semibold text-text-muted"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => {
              const detail = ranks.get(index)
              const tooltip = strategyTooltip(detail)
              const background = strategyBackground(detail?.rank)
              return (
                <tr
                  key={`${row.type}-${row.strike}`}
                  title={tooltip || undefined}
                  style={{ background }}
                  className={background ? '' : 'hover:bg-surface-hover'}
                >
                  {CHAIN_COLUMNS.map((column) => {
                    const text = formatChainValue(row[column.key], column)
                    const tone =
                      column.label === 'Chg'
                        ? row.change >= 0
                          ? 'text-up'
                          : 'text-down'
                        : column.label === 'IV'
                          ? 'text-text-muted'
                          : ''
                    return (
                      <td
                        key={column.label}
                        className={`num px-1 py-0.5 text-right whitespace-nowrap ${tone}`}
                      >
                        {column.label === 'Strike' && detail ? `${text}  #${detail.rank}` : text}
                      </td>
                    )
                  })}
                </tr>
              )
            })
          ) : (
            <tr>
              <td colSpan={CHAIN_COLUMNS.length} className="p-4 text-center text-text-dim">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
