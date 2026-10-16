# Memory v2 verification servers — unintended translation calls (2026-10-16)

## Immediate shutdown (this run)

- Ports **3100 / 3200**: no listener at investigation time (processes already exited).
- Preserved artifacts: `/opt/cursor/artifacts/verification-server-incident/` (`srv3100.log`, `srv3200.log`, `derived_cache_jobs_snapshot.json`, read-only `app.db` copy).

## Cause (confirmed from logs)

- Manual `tsx server.js` with `NODE_ENV=production`, shared `DATA_DIR=/workspace/data`, and live `.env.local` provider keys.
- **Previous owner:** `isDerivedCacheWorkerDisabled()` treated `NODE_ENV=production` as automatic worker ON when `DISABLE_DERIVED_CACHE_WORKER` was unset (`src/lib/derivedCache/jobs.ts`).
- `[aux_provider_call]` `gpt-6-luna` + `background-prompt-translation` dominated both logs (~109 + ~97 blocks).

## 204 vs 199 settled

- Log aux blocks (206 Luna) and provider settled count (199) are **not forced to match** — different counting (attempt vs settle, time window, failures).

## Queue / retry read (shared dev DB snapshot, not modified)

- `derived_cache_jobs`: 41 done, 9 pending, 1 processing at snapshot time.
- Log `jobId` values repeat across batches (e.g. ids 4, 5, 25, 27 with ~12–14 Luna aux lines each) → **retries / multi-batch translation on existing jobs**, not proof of a duplicate-server bug by itself.
- Two servers on the same `DATA_DIR` could both drain/work the same queue; treat as operational hazard, not a separate code defect without more evidence.

## Prevention (canonical owner — not launcher-only)

- `isDerivedCacheWorkerDisabled()` (boot / request / timer / kick) defaults ON **only** when `RAILWAY_ENVIRONMENT_NAME === "production"` — the existing Railway deploy-context predicate in `src/lib/railwayProductionBootGuard.js` (`isRailwayProductionEnvironment`). `NODE_ENV=production` alone stays OFF.
- Explicit allow remains `DISABLE_DERIVED_CACHE_WORKER=0`. Hard off remains `=1`.
- No new flag. Railway production already injects `RAILWAY_ENVIRONMENT_NAME=production`; **no Railway env change applied**.
- Launcher `scripts/memory-verification-prod-server.ts` still isolates DATA_DIR and **waits / SIGKILLs only its owned detached process group**.
