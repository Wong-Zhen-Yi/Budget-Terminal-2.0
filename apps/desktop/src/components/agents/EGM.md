# src/components/agents

## Overview
Components for the Agents page: chat messages, markdown rendering, run details, the workspace panel, and the agent chart views. Also the Pi provider settings and the Telegram settings.

## Interface
- Chat: `AgentMessages`, `AgentHistory`, `AgentRunDetails`, `AgentWorkspacePanel`, `AgentChatImage`, `AgentMarkdown`, `useAgentTranscript`, `useMiddleClickScroll`.
- Charts: `AgentCandlestickChart`, `AgentMarketChart`, `AgentPieChart`.
- Settings: `PiSettings`, `TelegramSettings`.

## Invariants
- None verified in this scan.

## Side Effects
- `AgentMarkdown` and `AgentMarketChart` reference `window.api` or `fetch` and must be checked before changing ([components/agents/AgentMarkdown.tsx], [components/agents/AgentMarketChart.tsx]).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:agents-ui` after `npm run build`
