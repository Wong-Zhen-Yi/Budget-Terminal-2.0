import type { PortfolioPayload } from './contract.js'

/** Exclude labels, display order, paths and Charts watchlists from market inputs. */
export function portfolioMarketInputs(payload: PortfolioPayload): string {
  return JSON.stringify([payload.activeId, payload.mainId,
    payload.portfolios.map(({ name: _name, ...book }) => book).sort((a, b) => a.id.localeCompare(b.id))])
}
