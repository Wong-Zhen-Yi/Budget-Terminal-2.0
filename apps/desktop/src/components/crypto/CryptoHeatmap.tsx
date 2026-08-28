import type { CryptoHeatmapTile } from '@shared/contract'
import {
  CRYPTO_HEATMAP_COLUMNS,
  CRYPTO_HEATMAP_LIMIT,
  cryptoMoney,
  cryptoPercent,
  cryptoPrice,
  cryptoTone,
  heatmapIntensity,
  rankSortValue,
} from '@shared/crypto'

/**
 * `_p19_build_heatmap` / `_p19_update_heatmap`: a fixed 30-cell grid, six across.
 *
 * The grid is fixed rather than built from the payload so a short response leaves empty
 * `#n --` cells where the missing coins belong, exactly as the reference does — the shape
 * of the panel never changes with coverage.
 */

/**
 * `_p19_heatmap_background`: the panel colour mixed toward the up/down accent by
 * `0.18 + intensity * 0.42`, where intensity is |move| saturating at 5%.
 */
function cellStyle(changePct: number | null): { background: string; color: string } {
  const tone = cryptoTone(changePct)
  if (tone === 'muted') return { background: 'var(--color-surface)', color: 'var(--color-text-dim)' }
  const amount = 0.18 + heatmapIntensity(changePct) * 0.42
  const hue = tone === 'positive' ? 'var(--color-up)' : 'var(--color-down)'
  return {
    background: `color-mix(in srgb, ${hue} ${(amount * 100).toFixed(0)}%, var(--color-surface))`,
    color: tone === 'positive' ? 'var(--color-up)' : 'var(--color-down)',
  }
}

export function CryptoHeatmap({ tiles }: { tiles: CryptoHeatmapTile[] }) {
  const sorted = [...tiles]
    .sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank))
    .slice(0, CRYPTO_HEATMAP_LIMIT)

  const cells = Array.from({ length: CRYPTO_HEATMAP_LIMIT }, (_unused, index) => ({
    index: index + 1,
    tile: sorted[index] ?? null,
  }))

  return (
    <div
      className="grid min-h-0 flex-1 gap-1 p-1"
      style={{
        gridTemplateColumns: `repeat(${CRYPTO_HEATMAP_COLUMNS}, minmax(0, 1fr))`,
        gridAutoRows: 'minmax(0, 1fr)',
      }}
    >
      {cells.map(({ index, tile }) => {
        const style = cellStyle(tile?.changePct ?? null)
        const rank = tile?.rank || index
        return (
          <div
            key={index}
            style={style}
            title={
              tile
                ? [
                    `Rank: #${rank}`,
                    `Name: ${tile.name || tile.symbol}`,
                    `Symbol: ${tile.symbol}`,
                    `Price: ${cryptoPrice(tile.price)}`,
                    `24h: ${cryptoPercent(tile.changePct)}`,
                    `Market cap: ${cryptoMoney(tile.marketCap)}`,
                    `Volume: ${cryptoMoney(tile.volume)}`,
                    `Source: ${tile.source || '--'}`,
                  ].join('\n')
                : 'Top cryptocurrency data has not loaded yet.'
            }
            className="flex min-h-0 flex-col items-center justify-center overflow-hidden border border-border px-1 text-center text-2xs leading-tight font-semibold"
          >
            {tile ? (
              <>
                <span className="truncate">{`#${rank} ${tile.symbol}`}</span>
                <span className="num truncate">
                  {cryptoPrice(tile.price)} {cryptoPercent(tile.changePct)}
                </span>
                <span className="num truncate opacity-80">{cryptoMoney(tile.marketCap, true)}</span>
              </>
            ) : (
              <>
                <span>{`#${index}`}</span>
                <span>--</span>
                <span>--</span>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
