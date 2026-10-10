# TRPG #1462 Gemini GM one-shot execution gate

Status:
- PRECALL_READY
- ONE_SHOT_TRANSPORT_VERIFIED
- DURABLE_JOURNAL_VERIFIED
- APPROVAL_GATE_VERIFIED
- PAID_EXECUTION_GATE_VERIFIED: **not claimed** — TEST_ONLY mock approval only; no live approval record; actual provider POST = 0
- BLOCKED: no

Provider POSTs this turn: **0**
Production DB writes: **0**
Sealed fixture hashes: **unchanged**

#1465 persist, #1480 prompt, #1468 evidence, #1477 12-call, and #1483 Golden v1 were not edited.

## BEFORE

The one-shot executor reserved a journal row, then POSTed with `Content-Type` only. The journal string `approval=REQUIRED_BEFORE_POST` was documentation, not a gate. The exclusive lock created an empty `wx` file and wrote the PID afterwards, so a waiter could treat the empty file as a stale PID and unlink it.

## PROBLEM

A concurrent waiter could steal the lock. A mock caller could reach HTTP without a paid-approval record or provider auth headers. A reserve/result write that failed durability could still be treated as sendable.

## ROOT CAUSE

1. Lock ownership was assigned in two steps (`wx` then PID) and stale-PID unlink was automatic.
2. Approval lived only on the journal object.
3. Experiment transport built its own headers instead of reusing `buildCheaperInferenceHeaders` with an explicit key.
4. Result files used a non-atomic write, and reserve fsync was not a hard pre-HTTP gate.

## OWNER MAP

- Sealed fixture / hashes: `trpg1462GeminiGmNewBenchmark` (unchanged)
- Journal + exclusive lock + atomic JSON: `trpg1462GeminiGmPrecallJournal`
- Body: `buildTrpgGmProviderRequest` / `adaptTrpgGmChatBody`
- Experiment POST: `executeTrpg1462OneShot` (injected `fetchImpl` only)
- Provider auth headers: `buildCheaperInferenceHeaders` via experiment-only `buildTrpg1462OneShotProviderHeaders`
- Production retry: `callTrpgGm` / `postTrpgGmStream` — unused and unmodified

## AFTER

- Existing lock files are never auto-deleted. Release requires the holder token. Stale-PID recovery is manual.
- Default approval is DENY. Mock tests pass an explicit `TEST_ONLY` / `TEST_FIXTURE` record (experiment, case IDs, per-request SHAs, model, provider, call cap, cost cap, execution SHA, grantedBy). Cursor does not mint a live paid approval.
- Auth headers are built from an explicit key before reserve. Missing key fails closed with `AUTH_MISSING` and does not consume a reservation. Secrets are not logged.
- Reserve writes fsync the file and directory. Fsync failure forbids HTTP. Results use the same atomic 0600/0700 writer. `not_sent` / `attempted` / `possiblySent` / `confirmed` are distinct. UNKNOWN, timeout, reserved, and result-write failure never retransmit.

## REMOVED

- Automatic stale-lock unlink / dead-PID recovery
- Content-Type-only experiment headers
- Ambiguous “posts” increment before the injected fetch runs

## PRESERVED

Pinned A/B/C/D hashes, persist defense, #1480 wording, production GM parameters, length contract, production DB, #1477 and #1483 paths, existing file journal (no new DB), production `callTrpgGm`.

## REGRESSION RISKS

A process crash after `wx` and before the lock token is written leaves an uncleared lock that must be removed manually after journal and process inspection. A crash after POST and before settle leaves `reserved` + `attempted`/`possiblySent` and is not retransmitted.

## PROOF

- A–J mock suite kept (11)
- PRECALL hash suite kept (5)
- Deterministic empty-lock unlink proof (legacy algorithm)
- Existing-lock auto-delete blocked, including dead PID
- Non-owner release forbidden
- Approval missing / SHA mismatch denied; TEST_ONLY mock allowed
- AUTH_MISSING before reserve
- Authorization scheme present without secret material in the mock log
- Reserve fsync failure → 0 POST
- Result-write failure → `reserved` + `possiblySent`, no retransmit
- 5xx / timeout / UNKNOWN / restart / concurrent processes
- Sealed request hashes unchanged
- Production DB writes 0
- Actual provider POST 0

## SYSTEM DELTA

Hardening of the existing one-shot executor and journal lock only. No new experiment runner, no billing change, no production GM path change.
