# src/components/ui (shared primitives)

## Overview
Shared low-level controls: buttons, chips, checkboxes, number and text inputs, search, select, modal, panel, data table, splitter, and the number-privacy controls. Every page reuses these ([AGENTS.md:Independent Focus Page Designs]).

## Interface
- Controls: `Button`, `Chip`, `Checkbox`, `NumberInput`, `TextInput`, `SearchInput`, `Select`.
- Layout: `Modal`, `Panel`, `PanelMessage`, `Splitter`, `MobileDisclosure`.
- Data: `DataTable`, `BarCell`.
- Privacy: `NumberPrivacy`, `useNumberPrivacy`.

## Invariants
- Controls use the existing palette tokens ([AGENTS.md:Locked Colour Scheme]).

## Side Effects
- None verified in this scan beyond props and hook state. Check `useNumberPrivacy` before assuming it is side-effect free.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:inputs-ui` after `npm run build`
