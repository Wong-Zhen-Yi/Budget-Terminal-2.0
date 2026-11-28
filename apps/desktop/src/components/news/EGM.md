# src/components/news

## Overview
News UI: the reader, sections, hero, thumbnails, the ticker search bar, the toolbar, the summary button, and the signal meter.

## Interface
- `NewsReader`, `NewsSection`, `NewsHero`, `NewsThumb`, `NewsSourceStrip`, `NewsSummaryButton`, `NewsTickerBadge`, `NewsTickerSearchBar`, `NewsToolbar`, `SignalMeter`.
- Hooks and helpers: `useCardColumns`, `useProgressiveCount`, `groupNewsLiteStories`, `matchesNewsLiteText`, `tagTone`, `ageClass`, `toneClass`.

## Invariants
- Article links and thumbnails are fetched by the main process, which enforces public addresses ([electron/services/news/EGM.md](../../../electron/services/news/EGM.md)).

## Side Effects
- None in the renderer beyond props and hook data. News data comes through the `api/` hooks ([src/api/EGM.md](../../api/EGM.md)).

## Verification
- Run: `npm run typecheck`
