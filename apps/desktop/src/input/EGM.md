# src/input (controller navigation)

## Overview
Gamepad or controller navigation for the renderer. It reads controller state, moves focus, scrolls panels, and runs actions.

## Interface
- `controller.ts:CONTROLLER_SHORTCUTS`, `controller.ts:ControllerReader`.
- `controllerNavigation.ts:moveControllerFocus`, `controllerNavigation.ts:scrollControllerPanel`, `controllerNavigation.ts:performControllerAction`.
- `useControllerNavigation.ts:useControllerNavigation`.

## Invariants
- Controller shortcuts are defined in one map, `controller.ts:CONTROLLER_SHORTCUTS`.

## Side Effects
- Reads controller input through `ControllerReader` ([controller.ts:ControllerReader]). Focus and scroll changes update the DOM.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:controller`
