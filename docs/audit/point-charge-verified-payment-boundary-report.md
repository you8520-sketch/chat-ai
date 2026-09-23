# Point Charge Verified-Payment Boundary BUGFIX

## Classification

`ROOT_CAUSE_FIXED` for the current point-charge payment boundary.

## BEFORE

Two separate charge owners existed.

1. Legacy mock route:
   `POST /api/points/charge`
   → authenticated user
   → `creditPointChargePackage()`
   → paid/free points granted
   → no PortOne server verification

2. PortOne route:
   `prepare → browser payment → complete → fetchPortOnePayment → markPortoneCheckoutPaid`

The PortOne finalizer also read `pending` before its transaction and credited points before the conditional `pending → paid` update. Two concurrent complete calls could both observe pending and both enter credit before only one status update won.

A second fail-open existed before checkout:
- browser store/channel configuration could enable checkout UI
- prepare route did not require `PORTONE_API_SECRET`
- a user could enter payment flow even when server completion verification could not succeed

## AFTER

Canonical paid point-purchase flow:

`prepare`
→ require payments enabled
→ require PortOne browser config
→ require PortOne server verifier
→ browser payment
→ `complete`
→ server fetch/verify paid status + amount
→ `markPortoneCheckoutPaid`
→ transaction atomically claims `pending → paid`
→ only claim winner credits points
→ transaction commit

Legacy `/api/points/charge` is fail-closed and cannot mint points.

The points UI has no mock-payment fallback. If verified PortOne checkout is not fully configured, the purchase UI is disabled and shows a setup message.

## OWNER MAP

| Responsibility | Canonical owner after |
|---|---|
| Point package catalogue | `plans.ts` |
| Checkout creation | `portoneCheckout.createPortoneCheckout` |
| Browser payment | `portoneBrowser.runPortOnePointCharge` |
| Server verification | `portoneServer.fetchPortOnePayment` + complete route |
| Exactly-once paid finalization | `portoneCheckout.markPortoneCheckoutPaid` |
| Point credit | `pointCharge.creditPointChargePackage`, called only after verified checkout claim |
| Legacy mock charge | disabled / fail-closed |

## EXACTLY-ONCE RULE

Inside one DB transaction:

1. load checkout
2. return already-paid if terminal
3. validate package
4. conditional `UPDATE ... WHERE status='pending'`
5. only successful claim credits points
6. any credit failure rolls back the paid status claim

The same payment finalized twice must create exactly one paid transaction, one charge log, one charge batch, and one payment-success notification.

## RAILWAY AUDIT

Recent 8 production deployments were checked for:
- `/api/points/charge`
- `/api/payments/portone/prepare`
- `/api/payments/portone/complete`

No recent HTTP hits were found.

Railway variable-name audit previously showed browser PortOne public configuration names present but no `PORTONE_API_SECRET` name. Values are redacted, so this report does not infer whether public values were usable. After this patch, missing server verification configuration disables checkout before payment begins.

## PRESERVED

- existing paid/free point ledger model
- PortOne server payment-status and amount verification
- existing point-charge packages
- existing charge cancellation path
- existing historical charge records
- no DB destructive migration

## SEPARATE FOLLOW-UP

Charge cancellation currently revokes local points before the asynchronous PortOne cancel request completes. A provider cancel failure can therefore leave local state cancelled while external payment refund failed. This requires a separate payout-style external-side-effect state/reconciliation audit and is intentionally not mixed into this PR.

## REGRESSION GATE

`src/lib/pointChargePaymentBoundary.test.ts` proves:
- same payment ID finalizes twice → credit side effects exactly once
- mock charge route cannot call the credit writer
- UI has no mock charge fallback
- browser + server verification configuration are both required
- conditional paid claim precedes point credit

Existing billing CI runs:
- diff hygiene
- lint
- subscription safety
- point-charge payment-boundary test
- typecheck
- production build
- billing authorization tests

Production provider calls in tests: 0.
