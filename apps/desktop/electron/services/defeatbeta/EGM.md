# electron/services/defeatbeta

## Overview
The DefeatBeta data source. It reads published Parquet datasets and builds the DefeatBeta terminal payload. Publication recency is checked before data is used.

## Interface
- `client.ts:DefeatBetaClient`, `client.ts:defeatBeta`, `client.ts:defeatBetaSymbol`.
- `decoder.ts:readDefeatBetaParquet`, `decoder.ts:closeDefeatBetaDecoder`.
- `data.ts:DEFEATBETA_PUBLISHED_SOURCE`, `data.ts:requireRecentPublication`, `data.ts:publishedObservation`.
- `news.ts:publishedNews`.
- `requestGate.ts:DefeatBetaRequestGate`.
- `terminal.ts:getDefeatBetaTerminal`.

## Invariants
- Data must pass `data.ts:requireRecentPublication`; otherwise the observation is rejected ([data.ts:requireRecentPublication]).
- Requests go through `DefeatBetaRequestGate` ([requestGate.ts:DefeatBetaRequestGate]).

## Side Effects
- Outbound HTTP to the published dataset ([client.ts:DefeatBetaClient]).
- Reads Parquet files and holds a decoder that must be closed ([decoder.ts:closeDefeatBetaDecoder]).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:defeatbeta`
