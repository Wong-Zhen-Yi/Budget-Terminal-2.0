import type { CardPerformance } from '@shared/contract'
import type { CardModel } from '@shared/cards'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

export function BasketDialog({
  model,
  performance,
  onClose,
  onOpenPortfolio,
}: {
  model: CardModel
  performance?: CardPerformance
  onClose: () => void
  onOpenPortfolio: (portfolioId: string) => void
}) {
  let weights = performance?.weights ?? {}
  if (!Object.keys(weights).length && model.weighting === 'custom') weights = model.weights
  if (!Object.keys(weights).length && model.weighting === 'equal' && model.symbols.length) {
    weights = Object.fromEntries(model.symbols.map((symbol) => [symbol, 100 / model.symbols.length]))
  }
  const symbols = [...model.symbols, ...('CASH' in weights ? ['CASH'] : [])]
  const label = performance?.weightingLabel
    ?? (model.weighting === 'portfolio'
      ? 'Actual weights loading'
      : model.weighting === 'custom' ? 'Custom weights' : 'Equal weight')
  return (
    <Modal
      title={model.name}
      width="430px"
      onClose={onClose}
      footer={
        <>
          {model.portfolioId ? (
            <Button variant="accent" onClick={() => onOpenPortfolio(model.portfolioId as string)}>
              Open Portfolio
            </Button>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <p className="mb-2 text-2xs font-semibold text-text">Basket holdings | {label}</p>
      <div className="border border-border">
        <div className="grid grid-cols-[1fr_120px] border-b border-border bg-surface-raised px-2 py-1 text-2xs text-text-muted">
          <span>Ticker</span><span className="text-right">Weight</span>
        </div>
        {symbols.map((symbol) => (
          <div key={symbol} className="grid grid-cols-[1fr_120px] border-b border-border px-2 py-1 text-2xs text-text last:border-b-0">
            <span>{symbol}</span>
            <span className="num text-right">{weights[symbol] === undefined ? '--' : `${weights[symbol].toFixed(2)}%`}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
