# src/components/youtube

## Overview
The YouTube player component.

## Interface
- `YouTubePlayer` - embedded player.

## Invariants
- The player embeds only URLs accepted by `electron/shared/youtubePlayer.ts:isYouTubeEmbedUrl` ([electron/shared/EGM.md](../../../electron/shared/EGM.md)).

## Side Effects
- Loads the embedded player and calls `window.api` for player control ([components/youtube/YouTubePlayer.tsx]).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:youtube-ui` after `npm run build`
