# electron/services/etf

## Overview
ETF holdings, arbitrage, and AUM data. It reads issuer and public holdings files in CSV, HTML, and XLSX formats, and maps holdings to S&P 500 sectors.

## Interface
- `snapshot.ts:resolveEtfSnapshot` - resolves the ETF snapshot used by the ETF page.
- `holdings.ts:getIssuerEtfHoldings`, `holdings.ts:preferredEtfIssuer`, `holdings.ts:parsePublicEtfHoldings`.
- `directory.ts:ETF_DIRECTORY_URL`, `directory.ts:parseEtfDirectory`, `directory.ts:parseEtfAssets`.
- `csv.ts:parseCsv`, `csv.ts:parseCsvRecords`, `csv.ts:decodeCsv`.
- `html.ts:parseTables`, `html.ts:textOf`, `html.ts:decodeEntities`.
- `xlsx.ts:parseXlsxRows`, `xlsx.ts:readZipEntries`, `xlsx.ts:excelColumnToIndex`.
- `sectorMap.ts:getSp500SectorMap`, `sectorMap.ts:resolveSector`.

## Invariants
- Sector assignment for holdings goes through `sectorMap.ts:resolveSector`.

## Side Effects
- Outbound HTTP to ETF issuer and directory pages ([holdings.ts:getIssuerEtfHoldings], [directory.ts:parseEtfDirectory]).
- Reads and decodes ZIP-based XLSX files in memory ([xlsx.ts:readZipEntries]).

## Verification
- Run: `npm run typecheck`
