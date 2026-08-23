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
