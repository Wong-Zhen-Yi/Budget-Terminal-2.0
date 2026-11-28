# src/components/articles

## Overview
Article presentation: page splitting and block layout, the visual block, export, and the schema that validates article visuals.

## Interface
- `articleBlocks` and `articlePages` - block and page helpers.
- `ArticleVisual` - renders an article visual block.
- `articleExport` - export helper.
- `articleVisualSchema`, `parseArticleVisual` - validate and parse visual blocks.

## Invariants
- Article visual blocks are validated with `parseArticleVisual` before rendering.

## Side Effects
- None (renders props or hook data). PDF export runs in the main process ([electron/services/EGM.md](../../../electron/services/EGM.md) `articlePdf.ts`).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:articles-ui` after `npm run build`
