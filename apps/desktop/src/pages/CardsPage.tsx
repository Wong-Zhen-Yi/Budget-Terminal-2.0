import { useCallback, useEffect, useMemo, useState, type PointerEvent } from 'react'

import type {
  CardInterval,
  CardPerformance,
  CardsMutation,
  CardsPerformanceRequest,
} from '@shared/contract'
import { CARD_INTERVALS } from '@shared/contract'
import {
  buildCardModels,
  reorderCardIds,
  type CardDropSide,
  type CardModel,
} from '@shared/cards'
import {
  useCards,
  useCardsMutation,
  useCardsPerformance,
  useRefreshCards,
} from '@/api/cardsQueries'
import { usePortfolio, usePortfolioMutation } from '@/api/queries'
import { BasketDialog } from '@/components/cards/BasketDialog'
import { CardEditorDialog } from '@/components/cards/CardEditorDialog'
import { StrategyCard } from '@/components/cards/StrategyCard'
import type { PanelStatus } from '@/components/chrome/StatusBar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

function cardDropTargetAt(clientX: number, clientY: number): {
  id: string
  side: CardDropSide
} | null {
  const card = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-card-id]')
  const id = card?.dataset.cardId
  if (!card || !id) return null
  const bounds = card.getBoundingClientRect()
  return {
    id,
    side: clientX < bounds.left + bounds.width / 2 ? 'before' : 'after',
  }
}

export function CardsPage({
  onStatusChange,
  onNavigate,
}: {
  onStatusChange: (panels: PanelStatus[], sourcePath: string) => void
  onNavigate: (tabId: string) => void
}) {
  const cardsQuery = useCards()
  const portfolioQuery = usePortfolio()
  const mutateCards = useCardsMutation()
  const mutatePortfolio = usePortfolioMutation()
  const refreshCards = useRefreshCards()
  const state = cardsQuery.data?.data
  const portfolios = portfolioQuery.data?.data.portfolios ?? []
  const models = useMemo(
    () => state ? buildCardModels(state, portfolios) : [],
    [state, portfolios],
  )
  const requests = useMemo<CardsPerformanceRequest[]>(() => {
    if (!state || !models.length) return []
    return CARD_INTERVALS.map((interval) => ({
      interval,
      cards: models.map(({ id, symbols, weighting, weights, shares, cashBalance }) => ({
        id,
        symbols,
        weighting,
        weights,
        shares,
        cashBalance,
      })),
    }))
  }, [models, state])
  const performanceQueries = useCardsPerformance(requests)
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<CardModel | null>(null)
  const [basket, setBasket] = useState<CardModel | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<CardModel | null>(null)
  const [draggingId, setDraggingId] = useState('')
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    side: CardDropSide
  } | null>(null)

  const performanceByInterval = useMemo(() => {
    const result: Record<CardInterval, Record<string, CardPerformance>> = {
      '1d': {},
      '30d': {},
      '1y': {},
    }
    requests.forEach((request, index) => {
      Object.assign(result[request.interval], performanceQueries[index]?.data?.data.results ?? {})
    })
    return result
  }, [performanceQueries, requests])
  const queryByInterval = useMemo(() => new Map(
    requests.map((request, index) => [request.interval, performanceQueries[index]]),
  ), [requests, performanceQueries])

  useEffect(() => {
    const panels: PanelStatus[] = [
      { label: 'Cards', envelope: cardsQuery.data, loading: cardsQuery.isFetching },
      ...requests.map((request, index) => ({
        label: `Cards ${request.interval}`,
        envelope: performanceQueries[index]?.data,
        loading: performanceQueries[index]?.isFetching ?? false,
      })),
    ]
    onStatusChange(panels, state?.sourcePath ?? '')
  }, [cardsQuery.data, cardsQuery.isFetching, onStatusChange, performanceQueries, requests, state?.sourcePath])

  const commit = useCallback(async (mutation: CardsMutation, success: string) => {
    const result = await mutateCards(mutation)
    setNotice(result.meta.freshness === 'partial'
      ? result.meta.failureReason ?? 'The card change was not saved.'
      : success)
    return result
  }, [mutateCards])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    setNotice('Refreshing card performance...')
    try {
      await refreshCards(requests)
      setNotice('Card performance updated.')
    } finally {
      setRefreshing(false)
    }
  }, [refreshCards, requests])

  const clearDrag = () => {
    setDraggingId('')
    setDragPoint(null)
    setDropTarget(null)
  }

  const reorder = (targetId: string, side: CardDropSide) => {
    if (!state || !draggingId || draggingId === targetId) {
      clearDrag()
      return
    }
    const order = reorderCardIds(
      models.map((model) => model.id),
      state.cardOrder,
      draggingId,
      targetId,
      side,
    )
    clearDrag()
    void commit({ type: 'reorder', order }, 'Card order saved.')
  }

  const pageLoading = cardsQuery.isFetching || portfolioQuery.isFetching
  const draggingModel = models.find((model) => model.id === draggingId)
  const status = draggingModel
    ? `Moving ${draggingModel.name} — drop at the blue marker.`
    : notice || (pageLoading
      ? 'Loading cards...'
      : `Showing ${models.length} card(s).`)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <div className="mr-auto">
          <h1 className="text-sm font-semibold text-text">Cards</h1>
          <p className="text-2xs text-text-muted">Equal-weight, custom-weight, and live portfolio baskets</p>
        </div>
        <span className="px-2 text-2xs text-text-muted">{status}</span>
        <details className="relative">
          <summary className="no-drag flex h-8 cursor-pointer list-none items-center border border-border-strong bg-surface-raised px-2 text-2xs text-text hover:bg-surface-hover">
            Portfolio Cards
          </summary>
          <div className="absolute right-0 z-20 mt-1 min-w-64 border border-border-strong bg-surface p-2 shadow-2xl">
            {portfolios.filter((portfolio) => !portfolio.readOnly).length ? (
              portfolios.filter((portfolio) => !portfolio.readOnly).map((portfolio) => (
                <label key={portfolio.id} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-2xs text-text hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={!state?.hiddenPortfolioIds.includes(portfolio.id)}
                    onChange={(event) => void commit({
                      type: 'setPortfolioVisible',
                      portfolioId: portfolio.id,
                      visible: event.target.checked,
                    }, event.target.checked ? 'Portfolio card shown.' : 'Portfolio card hidden.')}
                  />
                  {portfolio.name}
                </label>
              ))
            ) : <p className="text-2xs text-text-dim">No saved portfolios</p>}
          </div>
        </details>
        <Button variant="accent" onClick={() => { setEditing(null); setEditorOpen(true) }}>New Card</Button>
        <Button onClick={() => void onRefresh()} disabled={refreshing || !requests.length}>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {models.length ? (
          <div className="grid min-w-[1030px] grid-cols-4 items-start gap-2.5">
            {models.map((model) => {
              const interval = state?.intervals[model.id] ?? '1y'
              const cardPerformance: Partial<Record<CardInterval, CardPerformance>> = {}
              const loadingByInterval: Record<CardInterval, boolean> = {
                '1d': false,
                '30d': false,
                '1y': false,
              }
              const errorByInterval: Partial<Record<CardInterval, string>> = {}
              for (const key of CARD_INTERVALS) {
                const query = queryByInterval.get(key)
                const performance = performanceByInterval[key][model.id]
                cardPerformance[key] = performance
                loadingByInterval[key] = query?.isFetching ?? false
                errorByInterval[key] = query?.data?.errors.find(
                  (entry) => entry.symbol === model.id,
                )?.reason ?? (!performance && query?.data?.meta.freshness === 'failed'
                  ? query.data.meta.failureReason
                  : undefined)
              }
              return (
                <StrategyCard
                  key={model.id}
                  model={model}
                  interval={interval}
                  performanceByInterval={cardPerformance}
                  loadingByInterval={loadingByInterval}
                  errorByInterval={errorByInterval}
                  onInterval={(next) => void commit(
                    { type: 'setInterval', id: model.id, interval: next },
                    `${model.name} interval set to ${next}.`,
                  )}
                  onAction={() => {
                    if (model.type === 'custom') {
                      setEditing(model)
                      setEditorOpen(true)
                    } else setBasket(model)
                  }}
                  onHide={model.portfolioId ? () => void commit({
                    type: 'setPortfolioVisible',
                    portfolioId: model.portfolioId as string,
                    visible: false,
                  }, 'Portfolio card hidden.') : undefined}
                  onRemove={model.type === 'custom' ? () => setConfirmingRemove(model) : undefined}
                  dragging={draggingId === model.id}
                  dropSide={dropTarget?.id === model.id ? dropTarget.side : null}
                  onDragStart={(event: PointerEvent<HTMLButtonElement>) => {
                    setDraggingId(model.id)
                    setDragPoint({ x: event.clientX, y: event.clientY })
                    setDropTarget(null)
                  }}
                  onDragMove={(event) => {
                    setDragPoint({ x: event.clientX, y: event.clientY })
                    const target = cardDropTargetAt(event.clientX, event.clientY)
                    if (!target || target.id === model.id) {
                      setDropTarget(null)
                      return
                    }
                    setDropTarget((current) => (
                      current?.id === target.id && current.side === target.side
                        ? current
                        : target
                    ))
                  }}
                  onDragEnd={clearDrag}
                  onDrop={(event) => {
                    const target = cardDropTargetAt(event.clientX, event.clientY)
                    if (!target || target.id === model.id) {
                      clearDrag()
                      return
                    }
                    reorder(target.id, target.side)
                  }}
                />
              )
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-2xs text-text-dim">
            {pageLoading ? 'Loading cards...' : 'No cards are available.'}
          </div>
        )}
      </div>

      {draggingModel && dragPoint ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 flex max-w-64 items-center gap-2 rounded border border-accent bg-surface-raised px-2 py-1.5 text-2xs font-semibold text-text shadow-2xl"
          style={{ left: dragPoint.x + 12, top: dragPoint.y + 12 }}
        >
          <span className="text-accent">⋮⋮</span>
          <span className="truncate">{draggingModel.name}</span>
        </div>
      ) : null}

      {editorOpen ? (
        <CardEditorDialog
          card={editing ?? undefined}
          onClose={() => setEditorOpen(false)}
          onSave={(values) => {
            const mutation: CardsMutation = editing
              ? { type: 'update', id: editing.id, ...values }
              : { type: 'add', ...values }
            void commit(mutation, editing ? `Updated ${values.name}.` : `Added ${values.name}.`)
            setEditorOpen(false)
          }}
        />
      ) : null}
      {basket ? (
        <BasketDialog
          model={basket}
          performance={performanceByInterval[state?.intervals[basket.id] ?? '1y'][basket.id]}
          onClose={() => setBasket(null)}
          onOpenPortfolio={(portfolioId) => {
            void mutatePortfolio({ type: 'setActive', id: portfolioId }).then(() => {
              setBasket(null)
              onNavigate('portfolio')
            })
          }}
        />
      ) : null}
      {confirmingRemove ? (
        <Modal
          title="Remove Card"
          onClose={() => setConfirmingRemove(null)}
          footer={
            <>
              <Button onClick={() => setConfirmingRemove(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => {
                const target = confirmingRemove
                setConfirmingRemove(null)
                void commit({ type: 'remove', id: target.id }, 'Card removed.')
              }}>
                Remove
              </Button>
            </>
          }
        >
          <p className="text-2xs text-text-muted">Remove {confirmingRemove.name}?</p>
        </Modal>
      ) : null}
    </div>
  )
}
