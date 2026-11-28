# electron/workers

## Overview
Worker-thread entry points for heavy cache and quant work. The main process sends them typed messages through the RPC wiring in `services/`.

## Interface
- `cacheWorker.ts:CacheWork` - the message union for the cache worker.
- `quantWorker.ts:QuantWork` - the message union for the quant worker.
- Caller-side wiring: `services/workerRpc.ts:createWorkerRpc` and `services/quantWorker.ts` ([services/EGM.md](../services/EGM.md)).

## Invariants
- Messages must match the `CacheWork` and `QuantWork` unions ([cacheWorker.ts:CacheWork], [quantWorker.ts:QuantWork]).

## Side Effects
- Runs CPU-heavy cache and quant work off the main thread ([CLAUDE.md:Main process]).

## Verification
- Run: `npm run typecheck`
