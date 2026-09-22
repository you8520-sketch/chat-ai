# Subscription Recurring-Payment Safety BUGFIX

## Classification

`ROOT_CAUSE_FIXED` for the current dev/simulation system.

This change does not implement a real recurring-payment provider. It removes the unsafe mock billing writers and fails closed until a verified recurring-payment owner exists.

## BEFORE

Initial subscription:

`POST /api/points/subscribe`
→ `activateSubscription()`
→ update `sub_until/sub_plan/sub_auto_renew`
→ grant FREE membership points
→ payment-success notification

No provider payment was verified.

Renewal:

`processDueRenewals()`
→ find expired auto-renew users
→ update `sub_until`
→ grant FREE membership points
→ payment-success notification

No billing key, provider charge, provider transaction identity, reconciliation, or confirmed payment existed.

The same renewal writer was also called from the `/points` page read path.

## AFTER

- `POST /api/points/subscribe` fails closed with HTTP 503 when payments are otherwise enabled.
- `POST /api/cron/subscription-renew` cannot renew users and returns `renewed: 0`.
- `/points` no longer performs financial mutation.
- mock `activateSubscription()` and `processDueRenewals()` writers are removed.
- existing active subscriptions are not altered.
- cancellation remains available and only sets `sub_auto_renew=0`.

## OWNER MAP

| Responsibility | Owner after |
|---|---|
| Existing subscription paid-through state | existing user subscription fields |
| Cancel future renewal intent | `subscription.cancelAutoRenew` |
| Initial recurring payment | none — fail closed |
| Renewal provider charge | none — fail closed |
| Subscription benefit grant after verified payment | future provider integration |
| Point one-time PortOne charge | existing PortOne checkout path, separate system |

## RAILWAY PRODUCTION-PATH AUDIT

Production service: `chat-ai`.

Observed:

- Railway cron schedule: none
- `CRON_SECRET` variable name: absent
- `PORTONE_API_SECRET` variable name: absent
- PortOne browser public config variable names: present
- recent 8 deployments: no HTTP hits found for `/api/points/subscribe` or `/api/cron/subscription-renew`

Therefore no evidence was found that the unsafe subscription paths were recently executed, but their code paths were live and capable of mutation.

## REGRESSION GATE

`src/lib/subscriptionBillingSafety.test.ts` asserts:

- subscription owner contains no mock activation/renewal writer
- subscribe route cannot grant subscription/points
- cron route cannot renew/grant points
- points page cannot trigger renewal

Typecheck/build and repository CI must pass before merge.

## SEPARATE P0 FOLLOW-UP

`/api/points/charge` remains a mock point-charge endpoint that can grant points without PortOne server verification when payments are enabled. This is adjacent payment safety work but is intentionally not mixed into this subscription PR. It should be audited and fail-closed or removed next.
