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

## Code behavior (before this PR)

- `background-status-widget-extract` uses `unboundedNoReasoningRequest` in `src/lib/ai.ts`:
  `maxTokens=null`, `disableReasoning=true`.
- `resolveBackgroundMaxOutputTokens()` defines **3072** for widget extract but is bypassed on
  the unbounded path.
- `runExtractAttempt` passes `maxTokens: undefined` (`src/lib/statusWidget/extract.ts`).
- Tests (`extractRetry.test.ts`) expect V4 Flash widget extract caller output to remain unbounded.

> The `model` row above is the model that produced the row. It is **not** the
> operating background model today — see "Evaluation of the 6,279-token record"
> below.

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
     unbounded (see "There is no repair path" below — those kinds have no
     production call site at all).
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

### Evaluation of the 6,279-token record (PR #1677 review)

The 6,279-token row is **not** a measurement of the operating model.

| | 6,279 row (chat 707) | Operating model today |
|---|---|---|
| model | `deepseek-v4-flash` (cheaperinference) | `gpt-6-luna` (cheaperinference) |
| why | historical background primary | `resolveBackgroundPrimaryModelId()` migrates **every** historical DeepSeek primary alias (`deepseek-v4-flash`, `-0731`, V3) to `gpt-6-luna` |
| reasoning on the wire | `thinking: { type: "disabled" }` + `reasoning_effort: "none"` | `reasoning: { effort: "none" }` + `reasoning_effort: "none"` + `include_reasoning: false` |
| provider-reported completion | 6,279 for 10 stored keys | see measured table below |

**Provider usage accounting.** `parseOpenRouterUsage()` reads
`usage.completion_tokens ?? usage.output_tokens` verbatim as the completion
total, and `parseReasoningTokens()` reads `completion_tokens_details.reasoning_tokens`
separately. The 6,279 row recorded **no** `reasoning_tokens` / `thoughts_tokens`,
so the number is whatever the provider billed as completion total. It is
billable either way, but it is not the visible JSON size.

**Measured output tokens of the operating model family** (raw benchmark
artifacts, reasoning off, `reasoningSum: 0`):

| shape | provider output tokens | raw chars |
|---|---|---|
| 5-key single-source extract (7 samples) | 94 to **145** | 158 to 233 |
| 10-key combined extract, 5 character + 5 user (8 samples) | 183 to **229** | 332 to 395 |
| 5-key extract on `deepseek-v4-flash-0731` (1 sample) | **928** for 186 chars | 186 |

The DeepSeek row is the anomaly shape: the same 186-char / 5-key JSON bills
928 completion tokens (about 5.0 tokens/char vs about 0.55 for the Luna family)
and takes 52.4 s instead of 3.4 to 5.6 s. That is the signature of
provider-internal reasoning counted inside `completion_tokens` — the very
inflation Q3 asks about, observed on a model that is no longer the operating
primary.

**Budget vs. measured need.**

| widget | per-source budget | measured need | headroom |
|---|---|---|---|
| 5-key (default template, 1 free-text field) | 296 | 94 to 145 | 2.0x to 3.1x |
| 10-key (2 free-text fields) | 432 | about 190 to 240 (projected from the 10-key combined row) | 1.8x to 2.3x |
| 10-key combined | 2048 | 183 to 229 | 8.9x to 11.2x |

The 256 to 512 band is therefore **not** truncating a normal response of the
operating model. It would truncate `deepseek-v4-flash-0731` (928 tokens for a
5-key extract), which is exactly why the model migration matters for this
decision.

### Same input: old unbounded policy vs new limited policy

Both policies run the identical prompt, model, temperature and parser. The only
difference is the `max_tokens` field on the wire (`null` = field omitted =
provider default, versus a concrete number).

| | old policy (unbounded) | new policy (256 to 512 / 2048 to 3072) |
|---|---|---|
| wire body | no `max_tokens` field | `max_tokens: <per-widget budget>` |
| provider-reported completion, operating model | 94 to 229 (measured) | 94 to 229 (measured) — unchanged, the budget is not binding |
| provider-reported completion, `deepseek-v4-flash-0731` | 928 to 6279 (measured) | capped at the budget |
| **success condition** | the response is never truncated by the client; it fails only on a provider error or an unparsable body | the response is truncated unless the visible JSON **plus** any provider-internal reasoning fits in the budget |
| **failure condition** | provider error, or JSON that does not parse | the above, **plus** `finishReason=length` (a new failure mode introduced by the cap) |
| failure consequence | no values persisted | no values persisted — identical, because `finishReason=length` was already treated as a parse failure |
| detected how | `reasonCode=V3_PARSE_FAILED` / `V3_INITIAL_EMPTY` | the same, **plus** the new `likelyTruncated` diagnostic on the combined path |

In other words, for every response that fits the budget the two policies are
**observationally identical** — same prompt, same parse, same persisted values,
same failure handling. The new policy differs only by (a) capping the
worst-case bill, and (b) adding a truncation failure mode that the old policy
could not have. The evaluation above shows the measured operating-model
responses are 1.8x to 3.1x inside the cap, so (b) does not fire for a normal
response.

### There is no repair path (PR #1677 review correction)

An earlier draft of this document and the PR description stated that the
`-repair` / `-fallback` / `-volatile-echo-fix` siblings "stay unbounded so a
failed initial extract can still recover with a full-length answer". That is
**not true of the current code**:

- `git grep` for those three request kinds over non-test `src/` returns **no
  match** — they have no production call site.
- `extractStatusWidgetValuesForWidget({ repairOnly: true })` **skips the provider
  call entirely** (`if (!opts.repairOnly)` guards the only call) and returns
  `values: null` with `apiCalls: 0`.
- The combined path's per-source recovery calls that same `repairOnly` branch.

So the status-widget extract has a **hard one-attempt contract**: a failed
initial extract is terminal. Both facts are now pinned by regression tests in
`src/lib/statusWidget/extractOutputBudget.test.ts`.

### Failure impact per path (PR #1677 review)

| path | provider call(s) | on failure | user-visible status widget |
|---|---|---|---|
| single source (`background-status-widget-extract`) | 1 | `finishReason=length` gives a parse failure, so `values: null` and `finalReasonCode=STATUS_WIDGET_EXTRACT_EXHAUSTED` | **empty for that turn** — no fallback to previous values ("snapshot fallback stays removed", `src/lib/statusWidget/telemetry.ts`) |
| dual combined (`background-status-widget-extract-combined`) | 1 | one source may still succeed; the failed source falls into the `repairOnly` no-op, so `values: null` for that source | failed source **empty**, sibling source still rendered |
| shared (`background-post-turn-shared-initial`) | 1 (budget 4096, unchanged) | `shared.attempted` is set even on transport failure, so `sharedInitialConsumed` becomes true and the standalone per-source extract is skipped | **empty for that turn** — the shared call is the only physical attempt |

The shared path is the reason the truncation risk is asymmetric: its budget is
4 to 8x the measured need, so it is the least likely to truncate; the single
path is the tightest.

### Known trade-off

The status-widget extract has a hard one-attempt contract (no repair, no fallback).
If a provider reports its internal reasoning inside `completion_tokens` despite
`disableReasoning=true`, a tight budget can truncate the response. That case
degrades to *no values persisted* (`finishReason=length` is already treated as a
parse failure) rather than to partially-parsed values, and the new
`likelyTruncated` diagnostic makes it visible. Q3 (usage normalization) and Q4
(production p95 sample) remain open.

**Residual risk that the measurements do not close.** The budget formula is a
function of *field count* and *free-text field count* only — it does not depend
on value length. The measured 5-key samples are 158 to 233 raw chars; a widget
with two long narrative fields (the UI gallery fixture uses a 168-char value)
reaches about 400 raw chars, and the repository's own conservative estimator
(`estimateTokens` = chars x 0.9) then exceeds the 296-token budget for a 5-key
widget. No captured production sample has that shape, so the budget was left
unchanged rather than raised on speculation; a future production sample with
long values should be re-measured before the floor is moved.

### Out of scope here

- Provider usage normalization when `disableReasoning=true` but `completion_tokens`
  is inflated (Q3) — the provider-side accounting question is unchanged by this PR.
- p95 widget extract duration + token histogram on a production sample (Q4) —
  needs a live production window, not a code change.
