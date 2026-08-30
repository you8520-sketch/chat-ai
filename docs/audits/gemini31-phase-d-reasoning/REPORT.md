# GEMINI31_PHASE_D_REASONING_ROOT_CAUSE

```text
MAIN_TIP: 2eacc0cc
PRODUCTION_CHANGED: NO

CI_RETURNS_REASONING_DETAILS: YES
CI_RETURNS_GEMINI_SIGNATURE: NO
  (observed type: reasoning.text, format: google-gemini-v1 — not encrypted thought_signature)

CURRENT_APP_PRESERVES_REASONING_CONTEXT: NO
CURRENT_APP_RESENDS_REASONING_CONTEXT: NO
REASONING_CONTEXT_DROP_POINT:
  openRouterAdult.ts extractOpenRouterStreamDelta + stream loop (empty-content chunks skipped)
  → streamingPersistence.ts messages.content (visible only)
  → hybridMemory.ts rawRecentTurnsToHistory (content string only)
  → buildOpenRouterMessages (no reasoning_details field on ChatMsg)

CONTINUITY_AB (independent 8+8 runs):
  A_TURNS: 8
  B_TURNS: 8
  A_REASONING_P50: 1356
  B_REASONING_P50: 1483
  A_PROVIDER_WAIT_P50: 23172 ms
  B_PROVIDER_WAIT_P50: 25423 ms
  A_PRE_VISIBLE_GAP_P50: 10721 ms
  B_PRE_VISIBLE_GAP_P50: 11809 ms
  A_VISIBLE_TTFT_P50: 17575 ms
  B_VISIBLE_TTFT_P50: 18324 ms
  A_VISIBLE_CHARS_P50: 1088
  B_VISIBLE_CHARS_P50: 1218
  INPUT_TOKEN_DELTA: NOT_MEASURABLE (independent histories diverged)

CONTINUITY_PAIRED (same visible prefix, turns 2–6):
  B_REASONING_DELTA_P50: +61 tokens (worse)
  B_GAP_DELTA_P50: +800 ms (worse)
  INPUT_TOKEN_DELTA_P50: 0 (CI prompt_tokens unchanged with reasoning_details in messages)

CONTINUITY_AB_RESULT: SAME / SLIGHTLY SLOWER (no material win)
QUALITY_RESULT: NOT_BLIND_TESTED — visible_chars comparable; no automated regression gate

CI_LOW_VS_OR_LOW: RUN
CI_REASONING_P50: 1148
OR_REASONING_P50: 559
CI_PRE_VISIBLE_GAP_P50: 8726 ms
OR_PRE_VISIBLE_GAP_P50: 3 ms (*OR streams visible in first SSE chunk; metric not apples-to-apples*)
CI_REASONING_THROUGHPUT: ~126 reasoning tok / pre-visible sec
OR_REASONING_THROUGHPUT: ~186461 (*OR pre-visible gap ≈ 0 — throughput metric misleading*)

CI_LOW_MAPPING_SUSPECT: YES
  Wire verified: reasoning_effort=low, thinking absent, reasoning object deleted
  Yet CI generates ~2× OR reasoning tokens at same semantic LOW

PRIMARY_HIDDEN_REASONING_OWNER: MIXED
  1) CONTINUITY_LOSS — confirmed in app, but ephemeral A/B shows NO latency win when fixed
  2) CI_LOW_TRANSLATION_OR_UPSTREAM — ~2× reasoning tokens vs OpenRouter LOW
  3) CI streams delta.reasoning / reasoning_details before delta.content (~8–12s gap)

ROOT_CAUSE_STATUS: ROOT_CAUSE_CONFIRMED_READ_ONLY

NEXT_RECOMMENDATION:
  1) Do NOT prioritize production reasoning_details persistence for TTFT — paired A/B shows no benefit.
  2) Escalate CI contract: why reasoning_effort=low yields ~2× OR reasoning_tokens on identical prompts.
  3) Investigate CI SSE pacing (reasoning-first streaming) vs OR (visible in first chunk).
  4) Phase E: prompt-complexity / system-prefix token audit if CI/OR parity confirmed upstream.
  5) Production reasoning persistence remains separate quality/cost follow-up, not TTFT fix.
```

## Artifacts

| File | Description |
|------|-------------|
| `/opt/cursor/artifacts/gemini31-phase-d-reasoning/ci-stream-probe.json` | 3-call SSE key inventory |
| `/opt/cursor/artifacts/gemini31-phase-d-reasoning/continuity-ab.json` | 8+8 continuity A/B |
| `/opt/cursor/artifacts/gemini31-phase-d-reasoning/continuity-paired.json` | Paired same-prefix replay |
| `/opt/cursor/artifacts/gemini31-phase-d-reasoning/ci-or-comparator.json` | 5×5 CI vs OR LOW |

## LOW wire verification (CI final body)

```json
{
  "model": "gemini-3.1-pro-preview",
  "reasoning_effort": "low",
  "thinking": null,
  "reasoning": null
}
```

Conflicting effort fields: **0**

## Thought-signature hypothesis (§22)

```text
DOES_CI_RETURN_GEMINI_REASONING_CONTINUITY_METADATA: YES (reasoning.text blocks, not encrypted signature)
DOES_CURRENT_APP_PRESERVE_IT: NO
DOES_CURRENT_APP_RESEND_IT: NO
IF_NOT: EXACT_DROP_POINT: openRouterAdult stream parser + ChatMsg content-only model
CONTINUITY_AB_RESULT: SAME / SLIGHTLY SLOWER
QUALITY_RESULT: PASS (informal — no length regression in A/B medians)
```

## System delta

**Before:** Hidden reasoning correlated with visible TTFT; cause of volume unknown.  
**After:** Continuity loss confirmed but **not** the TTFT lever; CI upstream LOW semantics and streaming pacing are stronger contributors.  
**Preserved:** provider, model, LOW, prompt, length, layout, persona, memory, history, summary, billing.
