# Billing Turn Billable Usage — Correction Note

**Related:** PR #732 candidate foundation correction  
**Base:** Post–#728 route-composition audit

## #728 input finding status

```text
#728_INPUT_FINDING: PARTIAL
```

#728 correctly documented **LEVEL 1 route assembly** (primary `stage.input` + `promptAudit` cap → `totalInput`).

It did **not** fully trace **LEVEL 2 effective live pricing basis** for all premium models:

| Model | Route `totalInput` | Live pricing input basis |
|-------|-------------------|-------------------------|
| Gemini 3.7 Flash | `resolveTurnBillableInput(stage.input, promptAudit)` | `apiPromptTokensForCost` (= `apiReportedInputTokens ?? input`) |
| Gemini 3.1 Pro (OpenRouter `google/gemini-3.1-pro-preview`) | same | `totalInput` (route) — core token-floor path |
| Gemini 3.1 Pro (CI `gemini-3.1-pro-preview`) | same | `apiPromptTokensForCost` via unified-reasoning margins |
| Claude Opus 5 | same | `apiPromptTokensForCost` via unified-reasoning margins |

**Candidate responsibility:** LEVEL 1 route-assembled `NormalizedBillableUsage`.  
**Diagnostics:** expose `livePricingPromptBasis` / `livePricingCompletionBasis` separately — do not collapse with route prompt.

## Cache evidence

Production `StageUsage` writers omit cache fields when zero/unreported (`openRouterAdult.ts`).  
Absence is **not** proof of zero cache savings (see `parseOpenRouterUsage` / cache diagnostics).

Candidate coverage: unreported cache → `partial`, not `complete`.
