# src/components/heatmap

## Overview
The index heatmap and its colour palette reader.

## Interface
- `IndexHeatmap` - heatmap component.
- `readHeatmapPalette` - reads the heatmap palette from CSS tokens.
- `FALLBACK_HEATMAP_PALETTE` - fallback palette when tokens are missing.

## Invariants
- The palette is read from theme tokens with a fallback palette defined in the same folder ([AGENTS.md:Locked Colour Scheme]).

## Side Effects
- None (renders props or hook data).

## Verification
- Run: `npm run typecheck`
