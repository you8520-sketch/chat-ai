# Payout Exactly-Once BUGFIX Report

**Classification:** `ROOT_CAUSE_FIXED`
**Base:** `f13ea612fc942418a0271f05db209b76ecc077c2` (main)
**Branch:** `cursor/payout-exactly-once-bugfix-4604`

---

## ROOT CAUSE

Pre-fix `processSingleWithdrawal()` called `sendMoneyToUser()` before any durable exclusive execution claim. Two workers could both cross the external side-effect boundary, and a crash after provider dispatch could be retried without a durable execution state.

## CORRECTION PASS FINDINGS

The first patch version improved claim/idempotency handling but still had two merge-blocking risks:

1. It expanded `withdrawal_requests.status` with `PROCESSING` / `RECONCILIATION_REQUIRED` by rebuilding the existing table.
2. A row already marked as processing could re-enter `transfer()`, so crash recovery still depended on provider-side idempotency.

The correction pass removes both risks.

## CANONICAL OWNERS AFTER

| Responsibility | Canonical owner |
|---|---|
| Withdrawal request + CP deduction | `creatorPoints.requestCreatorWithdrawal` |
| Withdrawal business status | existing `withdrawal_requests.status` contract: PENDING / APPROVED / REJECTED / FAILED |
| Payout execution state | `payout_transfer_attempts.state` |
| Batch orchestration | `payoutQueue.processPayoutQueue` |
| Single execution state machine | `payoutExecution.executeWithdrawalPayout` |
| Stable request identity | `payoutTransferAttempts.stableProviderRequestId` |
| Provider transfer + lookup | `payoutGateway.getPayoutProviderPort()` |
| CP rollback | `payoutExecution.finalizeFailedWithRollback` |
| Admin execution visibility | LEFT JOIN to `payout_transfer_attempts` |

## EXECUTION STATE MACHINE

`withdrawal_requests` is not rewritten.

The durable attempt state is:

`CLAIMED → DISPATCHED → SUCCEEDED | FAILED | RECONCILIATION_REQUIRED`

Safety semantics:

- `CLAIMED`: provider dispatch has not started; a later run may resume and send once.
- `DISPATCHED`: external request boundary was crossed. Automatic transfer retry is forbidden.
- `RECONCILIATION_REQUIRED`: lookup/reconciliation only. No automatic resend and no CP rollback.
- `SUCCEEDED` / `FAILED`: terminal and immutable.

A stale reconciliation result cannot overwrite a terminal result.

## PROVIDER CAPABILITY

Current gateway is simulation-only. The simulation supports stable request identity and lookup.

Real PortOne/Toss payout is not integrated. Before real payout go-live, provider idempotency and reconciliation semantics must be audited again. This PR does not claim real-provider exactly-once guarantees.

## REGRESSION PROOF

`src/lib/payoutExactlyOnce.test.ts` covers:

1. legacy send-before-finalize double-send reproduction
2. two workers with no provider dedupe → one transfer
3. one atomic attempt owner
4. crash after claim but before dispatch → safe one-time send
5. crash after DISPATCHED → lookup only, transfer count zero
6. provider throw after dispatch → reconciliation, no later resend
7. unknown provider outcome → no resend, no CP rollback
8. confirmed failure → CP rollback exactly once
9. APPROVED withdrawal → never resent
10. terminal attempt state cannot be overwritten by stale reconciliation
11. legacy PENDING withdrawal executes without withdrawal table rewrite

Adjacent payout policy and admin payout tests are also required to pass.

## SYSTEM DELTA

### BEFORE

`withdrawal_requests` doubled as request/final status while the external transfer had no durable execution-state owner.

### PROBLEM

The external side effect could occur before a durable exclusive state transition, and crash recovery could resend.

### AFTER

`withdrawal_requests` keeps its existing business-status contract. `payout_transfer_attempts` is the single owner of execution state and provider-dispatch history.

### REMOVED

- withdrawal table rewrite for PROCESSING / RECONCILIATION_REQUIRED
- automatic resend after a durable DISPATCHED boundary
- terminal attempt state overwrite by stale reconciliation

### PRESERVED

- withdrawal request creation
- CP deduction at request time
- PENDING / APPROVED / REJECTED / FAILED status contract
- cron and manual entry through the same payout queue owner
- existing payout tax/finance snapshots

**PRODUCTION CALLS = 0** in tests.
