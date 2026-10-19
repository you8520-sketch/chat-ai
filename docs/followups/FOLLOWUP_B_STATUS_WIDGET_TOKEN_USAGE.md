# FOLLOWUP_B_STATUS_WIDGET_TOKEN_USAGE

## Context

Chat 707 status-widget extract (ledger row 1653, assistant 3750):

| Field | Value |
|---|---|
| provider | cheaperinference |
| model | deepseek-v4-flash |
| request_kind | background-status-widget-extract |
| input_tokens | 11049 |
| output_tokens | 6279 |
| finishReason | stop |
| HTTP | 200 (1 attempt, semantic success, no OpenRouter failover) |
| stored widget keys | 10 |

## Code behavior (intentional today)

- `background-status-widget-extract` uses `unboundedNoReasoningRequest` in `src/lib/ai.ts`:
  `maxTokens=null`, `disableReasoning=true`.
- `resolveBackgroundMaxOutputTokens()` defines **3072** for widget extract but is bypassed on
  the unbounded path.
- `runExtractAttempt` passes `maxTokens: undefined` (`src/lib/statusWidget/extract.ts`).
- Tests (`extractRetry.test.ts`) expect V4 Flash widget extract caller output to remain unbounded.

## Assessment

6279 output tokens is **provider-reported completion total**, not visible JSON size (10 keys).
Usage JSON did not record separate `reasoningOutputTokens` / `thoughtsTokens` despite
`disableReasoning=true` — possible provider/usage accounting follow-up, not proven reasoning leak.

## Audit questions (separate PR)

1. Cap vs unbound: cost/latency tradeoff for 10-key structured extract.
2. Should `resolveBackgroundMaxOutputTokens(3072)` apply to initial extract while keeping repair
   unbounded?
3. Provider usage normalization when `disableReasoning=true` but completion_tokens is inflated.
4. p95 widget extract duration + token histogram on production sample.

## Out of scope for PR #601

- Token cap changes
- Provider failover changes (see PR #600)
- Widget extract model/routing changes

## Resolution (this PR)

Audit questions 1 and 2 are answered by **wiring the budget helpers that already
existed but were never used**.

### What was actually missing

`src/lib/statusWidget/extractNormalize.ts` already defined the intended budgets:

- `resolveWidgetOutputSizeProxy(widget, keys)` — per-source budget, clamped to `[256, 512]`
- `resolveCombinedDualWidgetExtractMaxTokens(charWidget, userWidget)` — dual combined
  budget, clamped to `[2048, 3072]`

Neither was referenced from any call site. The extract path sent the budget nowhere:

- `runExtractAttempt` declared `maxTokens?: number` and then hardcoded
  `maxTokens: undefined` when calling the provider.
- The dual combined path computed `const combinedMaxTokens: number | null = null`.
- `src/lib/ai.ts` folded "unbounded output" and "reasoning disabled" into one
  predicate, so `background-status-widget-extract` forced `maxTokens: null` and
  discarded even an explicit budget.

### What changed

1. `src/lib/ai.ts` — new exported `resolveBackgroundOutputBudget(requestKind, explicitMaxTokens)`.
   The old single predicate was split into two independent decisions:
   - *reasoning disabled + untrimmed prompt* — **unchanged** for every kind.
   - *output budget* — the status-widget **initial** and **combined** kinds are now
     bounded; their `-repair` / `-fallback` / `-volatile-echo-fix` siblings stay
     unbounded so a failed initial extract can still recover with a full answer.
   - `background-memory-extract`, `background-lorebook-compact`,
     `background-status-meta-extract`, `background-suggested-replies-extract` keep
     their unbounded budget, and `background-post-turn-shared-initial` keeps 4096.
2. `src/lib/statusWidget/extract.ts` — `runExtractAttempt` now forwards
   `opts.maxTokens`; the single-source initial extract requests
   `resolveWidgetOutputSizeProxy(...)` and the dual combined initial extract
   requests `resolveCombinedDualWidgetExtractMaxTokens(...)`.
3. `isCombinedExtractLikelyTruncated` now receives a real budget instead of `null`,
   so the `likelyTruncated` diagnostic in `[StatusWidgetExtractAttempt]` is meaningful.

### Answers

- **Q1 (cap vs unbound)** — capped. The initial extract is a 10-key structured
  result; an unbounded completion can bill for an order of magnitude more tokens
  than the visible JSON. The cap is sized per widget, so a complex widget gets a
  larger budget than a plain one.
- **Q2 (3072 for initial, repair unbounded)** — yes, and the 3072 request-kind
  default stays as the fallback for callers that do not know the widget shape.
  The per-widget budget is applied where the widget *is* known.

### Known trade-off

The status-widget extract has a hard one-attempt contract (no repair, no fallback).
If a provider reports its internal reasoning inside `completion_tokens` despite
`disableReasoning=true`, a tight budget can truncate the response. That case
degrades to *no values persisted* (`finishReason=length` is already treated as a
parse failure) rather than to partially-parsed values, and the new
`likelyTruncated` diagnostic makes it visible. Q3 (usage normalization) and Q4
(production p95 sample) remain open.

### Out of scope here

- Provider usage normalization when `disableReasoning=true` but `completion_tokens`
  is inflated (Q3) — the provider-side accounting question is unchanged by this PR.
- p95 widget extract duration + token histogram on a production sample (Q4) —
  needs a live production window, not a code change.
