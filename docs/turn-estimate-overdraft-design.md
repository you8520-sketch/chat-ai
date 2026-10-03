# Per-turn estimate, admission, and limited overdraft

Design and evidence only. Live billing, 80P gate, picker wiring, and overdraft are unchanged.

Based on current `origin/main` (`b266e3a2`, includes merged PR #1381).
Successor to Draft PR #1385. Do not implement #1385 as written; this document absorbs the GPT review on #1385.

Candidate numbers (3× estimate, 1,000P open overdraft) are review inputs, not cost guarantees.

## PRIOR ART

| PR | State | Keep / drop |
| --- | --- | --- |
| #1381 | Merged. Fixed picker workload 20k in / 1,500 out / cache 0. Label `모델명 · 약 nP`. | Keep label owner and Published preview. Replace the fixed 20k/1,500 workload with the turn-estimate owner after policy review. |
| #1385 | Open Draft. 100P/800P fail-closed fixture + first overdraft sketch. GPT review: keep investigation-only. | Keep the 100P/800P cases as pre-fix evidence. Do not ship its source assertions as post-fix contracts. |

#1381 underestimates the 3,200+ length policy: 1,500 output tokens ≈ 2,250 Korean chars.

## BEFORE (current main)

1. Picker shows a room-independent 20k/1,500 Published display P.
2. `/api/chat` admits any user with `getPointBalance().total >= 80`. No hold. No in-flight lock.
3. `buildContext()` assembles the real prompt. History is trimmed to `HISTORY_TOKEN_BUDGET` (10k) plus a 4-turn floor — later turns do not sum all past tokens.
4. Main RP omits `max_tokens`. 3,200 chars is a soft aim, not a cap.
5. After a durable product is saved, `settleChatTurnBillingExactlyOnce` → `deductPointsOnDb`. Insufficient points roll back the whole IMMEDIATE txn.
6. `/api/chat` does not name `InsufficientPointsError`. Provider-cost ledger is written after settlement, so a failed user charge also drops platform cost evidence. The user still has ≥80P and can generate again.

100P vs 800P fixture (pre-fix): product kept, 0 settlements, 0 logs, balance 100, same `request_id` throws again, next new call allowed.

## PROBLEM

- Displayed price is not the current room/turn.
- 80P does not track model or context.
- Two in-flight supplier calls can both pass 80P. `BEGIN IMMEDIATE` only serializes the later deduct.
- Failed settlement leaves an unpaid readable product and allows unlimited repeats. Supplier invoice is already real.
- No overdraft owner. PAID/FREE lots cannot go negative (correct). There is also no separate liability record.

## OWNER MAP (current production)

| Responsibility | Canonical owner | Notes |
| --- | --- | --- |
| Final prompt assembly | `buildContext()` in `src/services/contextBuilder.ts` | First turn = character/world/rules/persona/note/opening/lorebook. Later = reassembled + trimmed history. |
| Local token estimate | `estimateTokens()` = `ceil(chars * 0.9)` in `tokenEstimate.ts` | Heuristic, not a provider tokenizer. `promptAudit` / `estimatedInputTokens` reuse it. |
| History bound | `trimHistoryToBudget` + `HISTORY_TOKEN_BUDGET` (10k) | Do not accumulate previous-turn totals. |
| Output aim | `UNIFIED_TIER_AIM_CHARS` = 3200 in `responseLengthConstants.ts` | Soft floor. UI: “더 길어질 수 있음”. |
| Actual usage | stage usage → `resolveTurnBillableUsage` / `normalizeBillableUsage` | Reasoning default `included_in_output`. |
| Published price + FX | `publishedUserCharge.ts` + `publishedModelPricing.ts` + `exchangeRate.ts` | No second price table. |
| Picker label | `formatPickerBaselineEstimateSuffix` / `selectedAIOptionLabel` | Format only. |
| Picker workload (now) | `computeMainRpPickerBaselineEstimates` 20k/1500 | To be replaced by turn-estimate workload. |
| Turn estimate (new, not live) | `src/lib/turnEstimate.ts` | Tokens + candidate 3× floor. Calls Published preview. |
| Call admission | 80P in `/api/chat` only | No Main RP in-flight lease (TRPG has its own). |
| Exactly-once settlement | `settleChatTurnBillingExactlyOnce` | Keep. No parallel charge engine. |
| Ledger credit/debit | `creditPointsWithIds` / `deductPointsOnDb` | Lots stay non-negative. |
| Refund | `refundMessageDeductionCore` | Restores original lots. Duplicate via `is_refunded` + `refunded_at`. |
| Paid cancel | `executePointChargeRefund` | Separate from chat settlement. |
| Attendance / expiry | `attendance.ts` + `expires_at > now` | 21d attendance, 1y paid/free. Refund must not mint new expiry. |
| Admin grant | `adminPointGrant.ts` | FREE only. |
| PortOne checkout | `canAccessPortoneCheckout` | Standard users need `PORTONE_CHARGE_ENABLED`. Reviewer accounts cannot make paid provider calls. |
| Overdraft | **none** | |

## AFTER (proposed)

### 1. Per-turn estimate (display)

New owner: `turnEstimate.ts`.

- Prompt tokens: `buildContext().meta.estimatedInputTokens` (or `promptAudit.totalAssembledTokens`) for the current assemble. First turn uses the real injected context. Later turns use the reassembled prompt, not a running sum.
- Output tokens: `ceil(max(3200, last_normal_assistant_chars) / 1.5)`.
- Cache: 0 unless a live cache hit is proven for that request.
- Reasoning: do not invent a display pad until per-model stats exist. The 3× admission candidate is the uncertainty buffer. Adding a fake reasoning pad *and* 3× double-counts.
- All six models: same Published + FX owner. Display = `Math.round(standardUserChargeKrw)`. Admission uses charge **ceil**.
- Picker still shows only `모델명 · 약 nP` via the existing suffix owner. SSR/chat-scoped refresh must not send the assembled prompt to the client.
- `GET /api/user/selected-ai` is account-global. Per-room numbers need a chat-scoped payload (SSR + a chat estimate refresh). Do not reuse the account GET as the authority.

Admission (server, immediately before the provider call, selected model + final assemble):

```
need = max(MIN_POINTS_TO_CHAT, ceil(chargeCeilPoints × 3))
```

Server wins if the picker is stale. 80P remains the floor when 3× ceil is smaller (cheap Flash / short first turns).

`turnEstimate.ts` is not imported by `route.ts` yet.

### 2. Admission / in-flight (single owner)

`BEGIN IMMEDIATE` at settlement is too late.

Proposed owner: user-scoped durable lease, claimed after the final server estimate and before the provider call, released on success, named failure, interrupt, or timeout.

- Duplicate click / extra tab: second claim fails. No second supplier call.
- Lease identity ≠ settlement identity. Settlement stays `UNIQUE(user_id, chat_id, request_id, charge_kind)`.
- Cost of a second completion that raced before the lease existed: treat as today’s fail-closed plus the under-recovered outcome below. After the lease ships, that race should be impossible.

### 3. Settlement failure BUGFIX (split from overdraft)

For **all** users, independent of overdraft eligibility:

1. Write `recordMainGenerationProviderCost` even when user settlement throws. Platform spend already happened.
2. Name `InsufficientPointsError` as a billing outcome. Do not reuse `completed_with_postprocess_error` / generic “Chat pipeline failed”.
3. Durable request-idempotent **under-recovered** row (new settlement outcome, not a second engine): `requested_points`, `settled_points` (lots actually consumed, usually 0 today), `platform_loss_points` or equivalent, provider-cost link. Replay of the same `request_id` must not create a second supplier call or a second liability.
4. One new-call gate for every user while an under-recovered row is open (new chat + regen + concurrent). This is not legal cash debt and not an automatic PortOne charge.

Cap overrun (actual > balance + allowed overdraft, or ineligible user): same under-recovered outcome. Do not hide already-streamed text. Do not stack extra negative lots.

### 4. Limited overdraft (opt-in FEATURE)

Activate only when the user can complete a real PortOne paid top-up (`canAccessPortoneCheckout` and payments actually enabled). Current legal copy: payments are not operating. So this stays off for ordinary production accounts until that changes.

Do not use PortOne reviewer accounts as RP test subjects (`getPaidProviderCallBlockReason` blocks paid provider calls).

One open overdraft per user. Candidate cap 1,000P.

Separate table. **No negative PAID/FREE lots.**

Same IMMEDIATE settlement:

1. Consume lots FIFO (current deduct).
2. Shortfall ≤ remaining cap and user eligible → open overdraft, settle full authorized user charge.
3. Shortfall above cap or ineligible → consume lots (or 0), write under-recovered for the remainder, do not invent extra user debt.

Balances (do not smash into one `users.points` number until every reader is audited):

| View | Meaning |
| --- | --- |
| Spendable lots | Unexpired PAID + FREE, always ≥ 0 |
| Open overdraft | Separate remaining liability, ≥ 0 |
| Display available | lots − overdraft (may be negative) |
| Admission available | same display available; block if `< need` or any open overdraft/under-recovered |

Lock: any open overdraft or under-recovered row blocks further paid generation (new chat + regen).

Unlock: **only a PortOne paid charge that drives open overdraft remaining to 0**. Attendance, signup, event, and admin **FREE** grants may offset remaining (see provenance) but must not clear the lock while remaining > 0. If product wants FREE offset without unlock, say so explicitly.

Tester unlock: `adminPointGrant` today credits FREE only, so it cannot unlock under this rule. Decide a dedicated admin close (existing admin auth, new action) — do not overload FREE grant.

### 5. Offset / refund / cancel provenance

GPT #1385: offset-first must not destroy the credit lot.

- Credit still inserts the original lot (type, source, expiry, paid-batch link).
- Offset events reference `credit_transaction_id` + `settlement_id` + amount. Lot `remaining_amount` decreases; the row stays.
- Refund of the AI turn: restore deduction slices to the same lots; reverse offset events to those lots **without new expiry**; close that settlement’s overdraft remaining. Expired attendance stays expired (`expires_at` unchanged). A fully-overdrafted turn (0 slices) refunds via overdraft events only — do not mint a fresh FREE lot.
- Duplicate refund: existing `is_refunded` / `report_refunds` / `refunded_at`.
- Paid-package cancel: restore unused remaining on the charge lots, then recompute offsets that pointed at those lots. Validate this before enabling auto-offset of paid top-ups. Cancel must not silently erase overdraft.
- Creator reward: still `paidCreatorRewardSpend(slices)` only. Overdraft and under-recovered remainder are not paid spend.

### 6. 3× adequacy (fixture FX 1560.6)

Linear Published pricing: `3 × (in+out) ≥ in + 2×out` always. So 3× covers a 2× output miss on the same input.

3× does **not** guarantee:

- Sol/Opus reasoning much larger than visible output
- 272k long-context rate switch
- Estimate built on a stale/short assemble
- `#1381` 1,500-out baseline (already below 3,200 chars)

Evidence in `src/lib/turnEstimate.test.ts`:

- 20k / 2,134 (3,200 chars) Sol ceil is higher than the merged 20k/1,500 picker.
- 100P is below Sol’s candidate 3× floor at 20k/2,134 — the 100P/800P unpaid repeat would have been blocked at admission.
- Cheap Flash 3× can still land on the 80P floor.
- 3× of that Sol estimate is still below 800P in the fixture — a held 3× can fail settlement. Overdraft/under-recovered remain required.

Until live per-model usage stats exist, do not treat 3× as a cost guarantee.

## STOP — not implementing live path in this PR

Unconfirmed:

1. Commercial rule: 3× hold, 1,000P cap, paid-only unlock.
2. Eligibility: PortOne-capable users only; payments are currently off.
3. Tester unlock: new admin close vs changing FREE grant.
4. Under-recovered vs overdraft split; product stays readable.
5. `users.points` / `getPointBalance` reader audit before signed available.
6. Paid-cancel × offset order.

Do not: rewrite settlement identity, insert negative lots, add `max_tokens` (separate quality policy), add speculative retry, activate overdraft for reviewer accounts, or auto-charge cards.

## Implementation sequence (later PRs)

1. **BUGFIX** (all users): provider-cost on settlement failure; named billing error; under-recovered outcome + new-call gate. No overdraft table.
2. **UI**: chat-scoped turn estimate → picker `· 약 nP`. Keep #1381 format owner. Fallback 20k/1,500 only when assemble is unavailable.
3. **Admission**: server 3× ceil + lease, after the numbers are reviewed against live usage.
4. **Overdraft FEATURE**: table + paid unlock, only if PortOne is really available for that user.

MUST FIX NOW in those later PRs only. This PR: estimate engine + 3× evidence + refreshed design + 100P/800P pre-fix fixture.

## SAFE OPTIONAL / FOLLOW-UP

- Per-model reasoning stats to shrink the multiplier
- Image / comic / TRPG
- UI “초과 사용 nP”
- `max_tokens` quality tradeoff
- Mobile truncation of long picker labels (already #1381 follow-up)

## Regression gate (implementation PRs)

First turn, long chat (trimmed history), model change, stream success, regen, fallback, concurrent tabs, PortOne top-up, offset, refund, expired attendance, 100P/800P, cap overrun, ineligible user, existing exact settlement.

Deduct, logs, overdraft/under-recovered, provider-cost ledger, and admin finance must match. No video. UI check after deploy.
