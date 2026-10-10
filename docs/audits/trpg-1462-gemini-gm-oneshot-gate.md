# TRPG #1462 Gemini GM one-shot execution gate

Status:
- PRECALL_READY
- ONE_SHOT_TRANSPORT_VERIFIED
- DURABLE_JOURNAL_VERIFIED
- PAID_EXECUTION_READY (gate only; live POST still requires a later approval)

Provider POSTs this turn: **0**
Production DB writes: **0**
Sealed fixture hashes: **unchanged**

#1465 persist, #1480 prompt, #1468 evidence, #1477 12-call, and #1483 Golden v1 were not edited.

## BEFORE

`trpg1462GeminiGmPrecallJournal` could compute `planned → reserved` in memory and write JSON. There was no executor that bound durable reserve to a single HTTP POST. Production `callTrpgGm` still retries HTTP 5xx twice.

## PROBLEM

A paid A/B/C/D run could double-send on retry, race, or restart.

## ROOT CAUSE

Reservation and transport were separate. `callTrpgGm` owns production retry and must not be the experiment path.

## OWNER MAP

- Sealed fixture / hashes: `trpg1462GeminiGmNewBenchmark` (unchanged)
- Journal + exclusive lock: `trpg1462GeminiGmPrecallJournal`
- Body: `buildTrpgGmProviderRequest` / `adaptTrpgGmChatBody`
- Experiment POST: `executeTrpg1462OneShot` (requires injected `fetchImpl`)
- Production retry: `callTrpgGm` / `postTrpgGmStream` — unused

## AFTER

`executeTrpg1462OneShot` verifies sealed fingerprints, approved case ID, body SHA, model `gemini-3.8-flash`, provider `cheaperinference`, and a 6-call cap. It takes an exclusive `wx` lock, writes `reserved` with fsync+rename, then performs at most one POST. 5xx / timeout / UNKNOWN do not retry. Results persist under `results/<id>.json`.

## REMOVED

Nothing from production GM runtime.

## PRESERVED

Pinned A/B/C/D hashes, persist defense, #1480 wording, production GM parameters, length contract, production DB, #1477 and #1483 paths.

## REGRESSION RISKS

A crash after POST starts but before settle write leaves `reserved` and a result file. That row is not retransmitted. A later human review can settle it; the executor will not POST again.

## PROOF

Mock HTTP cases A–J: 11/11. PRECALL hash suite: 5/5. `git diff --check`, `npm run lint`, `npm run typecheck:app` clean.

Railway `/data/private-trpg-1462-gm-precall` is `0700`, journal `0600`, SSH user `root`. Attempt journal still all `planned`. Verify-only write used `/data/private-trpg-1462-gm-precall/oneshot-verify/`. `#1477` and `#1483` directories were not opened.

## SYSTEM DELTA

Experiment-only executor + journal lock. No billing, provider adapter, retry, or prompt change.

Recommended later paid budget after approval: max 6 Gemini 3.8 Flash GM resolve calls. Opening 0, bot 0, retry 0.
