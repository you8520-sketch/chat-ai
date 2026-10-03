# Limited overdraft / settlement integrity

Investigation and design only. Live billing path is unchanged. Based on `origin/main` (`8d199fe5`).

Candidate numbers (1,000P cap, closed-beta only) are review inputs, not confirmed policy.

## BEFORE

Main RP chat is post-pay and fail-closed.

1. `/api/chat` checks `getPointBalance().total < MIN_POINTS_TO_CHAT` (80). This is an entry floor, not a hold and not a max-charge estimate. 100P passes. Regen uses the same route and the same gate.
2. The model is called. Main RP omits `max_tokens` (`resolveMaxOutputTokensForTarget` returns `undefined`). Output and reasoning follow provider defaults.
3. After a durable assistant product is saved (`generation_status=completed`), the route computes `cost` from actual usage (`computeTurnBilling` / `resolveChatBillingContract`) and calls `settleChatTurnBillingExactlyOnce`.
4. Settlement uses `BEGIN IMMEDIATE`, claim-first `UNIQUE(user_id, chat_id, request_id, charge_kind)`, then `deductPointsOnDb`. Lots are consumed FIFO by `expires_at`, then FREE before PAID. Lots never go negative.
5. If remaining lots cannot cover the charge, `InsufficientPointsError` is thrown. The whole settlement transaction rolls back, including the claim row. No `chat_billing_settlements` row, no `point_logs`, no slice persist, `users.points` unchanged.
6. `/api/chat` does not import or special-case `InsufficientPointsError`. The SSE catch treats it as a pipeline error: client sees `INSUFFICIENT_POINTS`, `done` is not sent, and if text exists the row may be rewritten to `completed_with_postprocess_error`. The product remains readable. `recordMainGenerationProviderCost` runs after settlement, so this request also skips the local provider-cost ledger even though the supplier already billed the platform.
7. The user still has 100P, so the 80P gate allows another generation. The same `request_id` replay also throws — there is no unpaid/idempotent marker.

Deterministic fixture: `src/lib/overdraftSettlementBaseline.test.ts` (100P vs 800P).

## OWNER MAP

| Responsibility | Canonical owner | Notes |
| --- | --- | --- |
| 80P entry floor | `MIN_POINTS_TO_CHAT` + `getPointBalance()` in `src/app/api/chat/route.ts` | Not a reserve. Also gates regen. |
| Final user charge | `computeTurnBilling()` / `resolveChatBillingContract()` → `requestedPoints` | Published + waiver + HTML-flash-only sibling. |
| Exactly-once settlement | `settleChatTurnBillingExactlyOnce()` in `chatBillingSettlement.ts` | IMMEDIATE + UNIQUE + claim-first. |
| Ledger deduct | `deductPointsOnDb()` in `points.ts` | Fail-closed. No negative lots. |
| Ledger credit | `creditPointsWithIds()` in `points.ts` | Signup, attendance, paid charge, gifts, admin. |
| Point logs / `users.points` | same deduct/credit owners | `users.points` is denormalized unexpired remaining. |
| Chat refund | `refundMessageDeductionCore()` in `refund.ts` | Restores original lots. `is_refunded` + `refunded_at`. |
| Paid charge cancel | `executePointChargeRefund()` / `chargeCancellation.ts` | Separate from chat settlement. |
| Regen charge | same `/api/chat` + new `request_id` | `REGEN_USER_CHARGE_SCOPE=REQUEST_LOCAL`. |
| Attendance credit | `attendance.ts` → `creditPointsWithIds(..., FREE, 21d, source=attendance)` | |
| Paid / general FREE expiry | `expiresModifier()` + `expires_at > now` filter | 1 year. No sweeper. |
| Image / comic deduct | `settleChatImageGenerationResult()` / comic route | Separate owners. Out of scope. |
| Admin finance | `adminFinance.ts` native `chat_turn` settlements + slices | Refunded events excluded. |
| Provider cost book | `recordMainGenerationProviderCost()` | After settlement in the chat route. |
| Overdraft | **none** | |

There is no closed-beta overdraft allowlist. `account_kind` is `standard` / `portone_reviewer` only.

## Preflight vs provider caps

Exact pre-generation charge is not possible.

- Picker `· 약 NP` is a 20k/1500 display estimate, not a hold.
- Main RP sends no `max_tokens`. Gemini / Sol / Opus follow provider defaults (Gemini family capability is tens of thousands of output tokens).
- Sol published long-context switch is 272k prompt tokens (2× input / 1.5× output). Reasoning `low|medium|high|xhigh|max` is billed; official Sol has no `none`.
- A 100P balance can therefore produce an 800P (or larger) actual charge after a successful stream.
- Bounding charge would require sending `max_tokens` / reasoning caps. That is a quality-policy change, not a settlement fix.

## Reproduced 100P / 800P state

| Surface | After failed settlement |
| --- | --- |
| Assistant product | Persisted, readable (`completed` at settlement layer; route catch may mark `completed_with_postprocess_error`) |
| User balance | 100P unchanged (FREE 100 or PAID+FREE mix unchanged) |
| `point_logs` | No negative row |
| `chat_billing_settlements` | 0 rows (claim rolled back) |
| `messages.deduction_slices` | null |
| `messages.is_refunded` | 0 |
| Public SSE | error `INSUFFICIENT_POINTS`, no `done` cost/remaining |
| Local provider-cost ledger | Not written on this request |
| Supplier invoice | Already incurred |
| Next new turn / regen | Allowed (100 ≥ 80) |
| Same `request_id` replay | Throws again |
| Refund / admin finance | Nothing to reverse; unpaid product is invisible to revenue |

## AFTER (proposed, not implemented)

Keep `settleChatTurnBillingExactlyOnce` as the only chat-turn settlement owner. Do not insert negative amounts into PAID/FREE lots. Do not auto-charge cards or create legal money debt.

### Separate overdraft record

Additive table (not a rewrite of `point_transactions`):

```
point_overdrafts
  id
  user_id
  settlement_id UNIQUE
  opened_amount        -- shortfall at settle time (e.g. 700)
  remaining_amount     -- reduced by later credits / refund
  limit_snapshot       -- cap used for this open (candidate 1000)
  created_at
  closed_at
```

Optional event log `point_overdraft_events` (`open` / `offset` / `refund`) for admin finance and duplicate-safe offset.

User-visible available balance:

```
available = unexpired(PAID+FREE remaining) - SUM(open overdraft remaining)
```

`getPointBalance()` and `users.points` sync must use `available` so the 80P gate, UI, and gifts see the same number. Ledger lots stay non-negative.

### One atomic settlement

Inside the existing IMMEDIATE transaction, after claim:

1. Consume lots for `min(balance, requested)` via current FIFO deduct.
2. `shortfall = requested - consumed`.
3. If `shortfall == 0`: current finalize.
4. If ineligible or `shortfall > remaining_user_cap`: rollback (today’s fail-closed).
5. If eligible: insert overdraft row, persist slices + overdraft amount on the same settlement, finalize `charged`, commit.

Idempotency stays `UNIQUE(user_id, chat_id, request_id, charge_kind)`. Concurrent turns serialize on IMMEDIATE. A second in-flight turn after the first opens overdraft sees `available < 0` and must be blocked by the same policy owner (not a second lock table).

### Offset, refund, block — one policy owner

Proposed module: `src/lib/pointOverdraft.ts` (name TBD). Callers:

- `settleChatTurnBillingExactlyOnce` (open)
- `creditPointsWithIds` (offset first, then insert leftover lot)
- `refundMessageDeductionCore` (close this settlement’s overdraft + reverse applied offsets)
- `getPointBalanceOnDb` / `syncUserPointsColumn` (available)

Candidate runtime policy (review only):

- Max open overdraft 1,000P per user (not stacked beyond the cap).
- New AI generation and regen blocked while `available < 0` (negative state).
- Later credits (paid, free, attendance) offset remaining overdraft first. Leftover keeps its original type/expiry/source.
- New free accounts: no overdraft.
- Closed-beta approved test accounts only: allowlist required.
- Provider charge above `balance + remaining_cap`: keep fail-closed. Product-retention policy is an open product decision.
- No automatic extra PortOne charge.

### Refund of an overdrafted turn

Settlement stores `{ slices, overdraft_opened }`.

Full refund of that settlement:

1. Restore original slices to the same lots (current owner).
2. Close remaining overdraft for that `settlement_id`.
3. Credit back offsets already applied against that settlement (same type/source as the offsetting credits), or the user loses later attendance/paid credits that paid a refunded turn.

Duplicate refund stays `is_refunded` + `report_refunds` pending/approved + `refunded_at`.

Paid-package cancel remains a lot-restore of unused remaining. It must not silently erase overdraft; cancel of unused lots is independent. If cancel needs to consider open overdraft, that is a follow-up.

## STOP — implementation blocked on GPT / user review

These are required before any live-path change:

1. **Billing policy change.** Allowing a turn to complete below zero is a new commercial rule.
2. **New eligibility / permission owner.** No closed-beta overdraft flag exists. A new column, `account_kind`, or allowlist is a new permission system.
3. **Additive schema.** New overdraft table is not destructive, but it is a durable finance table and needs migrate + rollback notes.
4. **`creditPointsWithIds` / `getPointBalance` semantics.** Every credit and every 80P/UI/gift reader changes.
5. **Product retention when even overdraft cannot cover.** Keep readable unpaid product (today), hide it, or mark unpaid. Do not add a retry that re-calls the provider.
6. **Do not rewrite** `chat_billing_settlements` identity or insert negatives into PAID/FREE lots.
7. **Do not add** speculative exception/retry around `InsufficientPointsError` without an owner.

No destructive migration is required for the proposed table.

## Implementation scope (later PR, after review)

MUST FIX NOW if policy is approved:

- Additive `point_overdrafts` (+ events if chosen)
- Policy owner module
- Settlement open + credit offset + balance available + refund reverse
- Eligibility gate (once the allowlist owner is named)
- Admin finance: overdraft remaining + offsets must reconcile with `point_logs` and settlements
- Regression tests listed below

REQUIRED CLEANUP:

- Route should treat `InsufficientPointsError` as a named billing outcome, not a generic pipeline error, so `completed_with_postprocess_error` is not overloaded
- Write provider-cost ledger even when user settlement fails (platform spend already happened)

SAFE OPTIONAL / FOLLOW-UP:

- UI “초과 사용 N P”
- Image / comic / TRPG overdraft
- `max_tokens` / reasoning preflight hold (quality tradeoff)
- Pre-generation reserve of estimated max
- Paid-package cancel interaction with open overdraft
- Sweeper for abandoned overdraft (not needed if credits always offset)

## Regression evidence required before merge of any implementation

| Case | Expected if candidate policy is adopted |
| --- | --- |
| 100P, 800P, eligible | Consume 100, open 700 overdraft, settlement charged 800, available −700 |
| 100P, 800P, ineligible / new free | Fail-closed as today |
| 100P, 1101P | Fail-closed (over 1000 cap) |
| 100P, 1100P | Boundary: consume 100, open 1000 |
| Concurrent two 800P | One settles (or one overdraft); the other fail-closes or is blocked; no double overdraft beyond cap |
| Duplicate `request_id` | Exactly-once; no second overdraft |
| Negative available | New chat + regen 402; no new provider call |
| +200 attendance after −700 | Overdraft 500; no FREE lot until leftover |
| +800 paid after −700 | Overdraft 0; PAID lot 100 |
| Refund after offset | Slices restored; remaining overdraft closed; applied offsets returned |
| Duplicate refund | Rejected |
| Paid vs FREE vs attendance | Lots stay typed; overdraft untyped |
| Provider usage above any estimate | Same settlement path; cap still applies |
| Normal 100 vs 100 / model change | Unchanged charged/waived/duplicate |

After implementation, actual deduct, `point_logs`, overdraft remaining, and admin finance must match.

## Classification

- This PR: investigation + baseline fixture + design. **No live billing change.**
- Implementation: blocked on STOP items above.
- Draft only. No auto-merge.
