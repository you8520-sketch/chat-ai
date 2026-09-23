# Point Charge Refund Exactly-Once BUGFIX

## Classification

`ROOT_CAUSE_UNCONFIRMED` until the deterministic regression suite and production build pass in CI.

## BEFORE

The charge-cancel path had two owners with the wrong ordering:

`POST /api/points/charge/cancel`
→ `cancelPointChargeBatch()`
→ local point transactions set to zero
→ `point_charge_batches.cancelled_at`
→ `portone_checkouts.cancelled_at`
→ local cancellation log inserted
→ HTTP success returned
→ only then `void cancelPortOnePayment(...).catch(...)`

A PortOne failure, timeout, or process crash after local commit could therefore leave:

- local UI = cancelled
- charged points = removed
- PG/card payment = not refunded or unknown

The client treated any HTTP success as final refund completion.

## PORTONE CONTRACT AUDIT

PortOne V2 cancellation is not a binary fire-and-forget operation.

- cancellation status can be `SUCCEEDED`, `FAILED`, or `REQUESTED`
- `REQUESTED` requires later confirmation by provider state/webhook/query
- payment lookup can expose cancellation state
- `currentCancellableAmount` is an optimistic consistency guard for the pre-cancel refundable balance

Therefore local cancellation cannot be finalized merely because the cancel POST was sent or returned a non-error response.

## AFTER

Canonical execution owner: `pointChargeRefundExecution.executePointChargeRefund()`.

Canonical external execution state owner: `point_charge_refund_attempts`.

States:

`CLAIMED | DISPATCHED | REQUESTED | SUCCEEDED | FAILED | RECONCILIATION_REQUIRED`

Flow:

`eligibility recheck + durable claim + reversible point hold`
→ mark `DISPATCHED`
→ one provider cancel call
→ provider status
→ success: local cancellation finalize
→ confirmed failure: restore held points
→ requested/unknown: keep hold and reconcile by lookup only

### Provider boundary invariant

Once state reaches `DISPATCHED`, automatic cancel resend is forbidden.

Recovery for:
- `DISPATCHED`
- `REQUESTED`
- `RECONCILIATION_REQUIRED`

uses provider lookup only.

### Point-spend invariant

The charged point lots are put on a reversible hold in the same DB transaction that creates the refund attempt.

This prevents:

provider refund starts
→ user spends charged points before local refund finalization
→ refund succeeds after points were consumed.

No `cancelled_at` and no local `결제 취소` log are written while the refund is merely pending/unknown.

Confirmed provider failure restores the held point amounts exactly once.

### Finalization invariant

Local business cancellation is finalized only when the durable refund attempt is `SUCCEEDED`.

Finalization then:

- verifies the original charged lots are still held
- sets `point_charge_batches.cancelled_at`
- sets `portone_checkouts.cancelled_at`
- inserts one cancellation point log
- syncs the user point balance

A crash after provider success is persisted but before local finalization can be recovered without another provider cancel call.

## OWNER MAP

| Responsibility | Canonical owner after |
|---|---|
| charge batch/history eligibility | `chargeCancellation.ts` |
| external refund execution state | `point_charge_refund_attempts` |
| refund execution orchestration | `pointChargeRefundExecution.ts` |
| provider-neutral refund contract | `pointChargeRefundProviderTypes.ts` |
| PortOne refund adapter | `pointChargeRefundGateway.ts` + `portoneServer.ts` |
| local business cancellation finalization | refund execution owner after provider `SUCCEEDED` |
| UI refund state labels/recheck action | `ChargeCancelButton.tsx` |
| canonical shared refund state type | `pointChargeRefundShared.ts` |

## REMOVED

- local-first `cancelPointChargeBatch()` mutation owner
- fire-and-forget `void cancelPortOnePayment(...).catch(...)`
- silent success when `PORTONE_API_SECRET` is missing
- UI assumption that every HTTP 2xx means final refund completion

## PRESERVED

- 7-day cancellation window
- unused charged-point requirement
- existing charge batch schema and historical data
- existing paid/free ledger semantics
- no destructive migration
- existing charge purchase verification path
- charge package prices and bonus rules

Historical charge batches with no PortOne checkout identity are now fail-closed for automatic refund rather than locally cancelled without external proof.

## RAILWAY PRODUCTION-PATH AUDIT

Current production service variable-name audit:

- `NEXT_PUBLIC_PORTONE_STORE_ID`: present
- `NEXT_PUBLIC_PORTONE_CHANNEL_KEY`: present
- `PORTONE_API_SECRET`: absent

Values were not exposed.

Therefore the deployed refund endpoint must fail closed with HTTP 503 before creating a refund attempt or point hold until the server verification/refund secret is configured.

## CRASH / CONCURRENCY MATRIX

| Scenario | Required result |
|---|---|
| two cancel requests | one durable owner; provider cancel at most once |
| crash after CLAIMED/hold, before DISPATCHED | next execution may dispatch once |
| crash after DISPATCHED | lookup only; no resend |
| provider timeout/unknown | RECONCILIATION_REQUIRED; hold retained |
| provider REQUESTED | REQUESTED; hold retained; next call lookup only |
| provider confirmed FAILED | FAILED; held points restored once |
| provider SUCCEEDED | local cancellation finalized once |
| crash after SUCCEEDED persisted before local finalize | local finalize resumes without provider call |
| missing PortOne checkout | fail closed; no hold |
| missing server secret | route 503 before hold |

## REGRESSION GATE

`src/lib/pointChargeRefundExactlyOnce.test.ts` covers:

- deterministic BEFORE local-first failure reproduction
- provider success exactly-once
- confirmed failure point restoration
- REQUESTED → lookup-only success
- unknown/timeout → no resend
- crash after CLAIMED
- crash after DISPATCHED
- persisted SUCCEEDED before local finalize
- missing PortOne checkout
- `currentCancellableAmount` request guard
- immutable terminal state
- two-worker provider cancel count
- legacy local-first owner removal
- missing-secret silent-success removal

Billing CI must additionally pass:

- diff hygiene
- lint
- existing billing boundary tests
- subscription safety
- verified point-charge purchase boundary
- app typecheck
- production build
- billing authorization tests

Provider calls in regression tests: 0.

## CHANGE BUDGET

### MUST FIX NOW

- external refund execution state
- provider-success-before-local-finalize ordering
- point hold during ambiguous/pending state
- no resend after DISPATCHED
- explicit pending/reconciliation UI/API state
- deterministic regression proof

### REQUIRED CLEANUP

- remove old local-first cancellation owner
- remove fire-and-forget cancel call
- centralize refund state type

### SAFE OPTIONAL

- PortOne webhook consumer to reconcile `REQUESTED` without user/admin recheck

### SEPARATE FOLLOW-UP

- surface `RECONCILIATION_REQUIRED` refunds in the future shared Ops Inbox rather than creating a refund-only admin subsystem
- configure and verify the real PortOne server secret before enabling live purchases/refunds

## STOP CONDITIONS

Stop rather than widening this PR if validation reveals:

- PortOne production API contract differs from the audited cancellation model
- destructive DB migration is required
- fixing refund correctness requires changing point prices/billing policy
- security/authentication boundaries must change
- unrelated payment systems require a broad refactor
