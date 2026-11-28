# src/components/cards

## Overview
Card UI: the card editor dialog, the basket dialog, and the strategy card.

## Interface
- `CardEditorDialog` - create and edit a card.
- `BasketDialog` - basket dialog.
- `StrategyCard` - card display.

## Invariants
- Saved cards are persisted by the main-process cards store ([electron/services/EGM.md](../../../electron/services/EGM.md) `cardsStore.ts`).

## Side Effects
- Saves through `window.api` via the `api/` hooks.

## Verification
- Run: `npm run typecheck`
