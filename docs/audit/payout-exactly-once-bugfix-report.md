# Payout Exactly-Once BUGFIX Report

**Classification:** `ROOT_CAUSE_FIXED`  
**Base:** `f13ea612fc942418a0271f05db209b76ecc077c2` (main)  
**Branch:** `cursor/payout-exactly-once-bugfix-4604`

---

## ROOT CAUSE

Pre-fix `processSingleWithdrawal()` called `sendMoneyToUser()` **before** `markApproved(... WHERE status='PENDING')`. No atomic claim; no stable provider idempotency key. Two workers could both transfer; crash after provider success could retry with a new unstable key.

## PROVIDER CAPABILITY FINDING

**Current production gateway:** simulation only (`payoutGateway.ts`). Code-verified simulation supports idempotency key, lookup, success/failed/unknown classes.

**Real PortOne/Toss:** NOT integrated — must re-audit A–H before go-live. State machine is provider-port ready via `PayoutProviderPort`.

## PAYOUT STATE MACHINE

| Before | After |
|--------|-------|
| PENDING → send → APPROVED/FAILED | PENDING → **atomic claim** → PROCESSING → provider (stable `wd-{id}`) → APPROVED / FAILED / RECONCILIATION_REQUIRED |

## CANONICAL OWNERS

| Responsibility | Owner |
|----------------|-------|
| Withdrawal creation + CP deduct | `creatorPoints.requestCreatorWithdrawal` |
| Batch orchestration | `payoutQueue.processPayoutQueue` |
| Single execution state machine | `payoutExecution.executeWithdrawalPayout` |
| Atomic claim | `payoutExecution.atomicClaimWithdrawal` |
| Provider transfer + lookup | `payoutGateway.getPayoutProviderPort()` |
| Stable request identity | `payoutTransferAttempts.stableProviderRequestId` |
| Attempt persistence | `payout_transfer_attempts` table |
| Success finalize | `payoutExecution.finalizeApproved` |
| Failure finalize + CP rollback | `payoutExecution.finalizeFailedWithRollback` (PROCESSING only) |
| Unknown outcome | `markReconciliationRequired` — **no auto resend, no CP rollback** |
| Reconciliation | `reconcileFromProviderLookup` on RECONCILIATION_REQUIRED |
| Scheduler | `payoutScheduler` (unchanged entry) |
| Manual script | `scripts/run-payout-once.ts` → same `processPayoutQueue` |

## PROOF

- `src/lib/payoutExactlyOnce.test.ts` — 9 deterministic fixtures (BEFORE structural + AFTER regression)
- `payoutPolicyUnification.test.ts`, `adminPayout.test.ts` — pass
- `npm run typecheck:app` — pass
- `SESSION_SECRET=... npm run build` — pass

**PRODUCTION CALLS = 0** in tests (mock/in-memory providers only).
