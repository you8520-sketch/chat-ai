# PHASE_D5B_FINAL — Gemini 3.1 Pro Runtime Stability

```
baseline main: 522f4810670bab639fb8800bc5eee4a125895a6b
branch: cursor/rp-gemini-runtime-stability-d5b-96c2
commit: (see tip after seal commit)
draft PR: https://github.com/you8520-sketch/chat-ai/pull/283

PROMPT:
  byte-identical: YES
  prompt delta: 0
  new rule: 0
  context packaging diff: 0

D5-B0:
  current temperature: 0.95
  current reasoning: { effort: "low" }
  current max_tokens: absent/null (intentional since eb30d787)
  current provider routing: deleted by applyGeminiProReasoning (OpenRouter default LB)

  historical runtime diff:
    found: YES
    details: |
      - 29aed45a: thinking kill via body.provider
      - 3a705b3e: restore effort=low + temperature=0.95 + delete body.provider
      - eb30d787: Gemini max_tokens 8192 → omit (resolveMaxOutputTokensForTarget → undefined)

  completion includes reasoning: YES
  reasoning-visible correlation:
    pearson: +0.486
    spearman: +0.333
  REASONING_VISIBLE_BUDGET_CONTENTION: INCONCLUSIVE

PROVIDERS:
  provider 1 exact slug: google-vertex   (display: Google)
  provider 2 exact slug: google-ai-studio (display: Google AI Studio)

B1 G6:
  provider1 chars: [3096, 1715, 1106]
  provider1 median: 1715
  provider1 max/min: 2.80
  provider1 reasoning: [4559, 2731, 1347] (median 2731)
  provider1 collapse: 2/3 (<1800)

  provider2 chars: [2936, 862, 1549]
  provider2 median: 1549
  provider2 max/min: 3.41
  provider2 reasoning: [6070, 1184, 1439] (median 1439)
  provider2 collapse: 2/3 (<1800)

  provider winner: NONE
  provider confirmation: NOT_RUN

  G5: NOT_RUN
  G3: NOT_RUN

  PROVIDER_STABILITY: FAIL
  PROVIDER_PINNING_NOT_SUFFICIENT: YES

B2 reasoning:
  RUN / NOT_RUN / NOT_APPLICABLE: NOT_APPLICABLE
  supported reasoning controls:
    mandatory: true
    supported_efforts: [high, medium, low]
    default_effort: medium
    production already at lowest: low
    supports_reasoning.max_tokens: false (field omitted)
  R0 / R1: NOT_RUN
  REASONING_STABILITY: NOT_APPLICABLE

B3 max tokens:
  RUN: YES (Arm A reused B1 P1; Arm B +3 calls)
  current absent chars: [3096, 1715, 1106] median 1715
  explicit 8192 chars: [1133, 2013, 3024] median 2013
  result: collapse persists under stop; one draw hit finish=length at output_tokens≈8188
          (reasoning 5645 + visible budget shared under cap)
  EXPLICIT_MAX_TOKENS_CAUSAL: NO
  EXPLICIT_MAX_TOKENS_NOT_CAUSAL (for early-stop short pathology): YES

temperature audit:
  RUN: YES (T0 reused B1 P1; T1 0.7 +3 calls)
  T0 0.95: [3096, 1715, 1106] median 1715 max/min 2.80 lt1800=2
  T1 0.70: [1702, 4070, 2704] median 2704 max/min 2.39 lt1800=1
  result: directional length↑ / variance↓ but FAIL stability gate

FINAL RUNTIME CLASSIFICATION: SAMPLING_VARIANCE_DOMINANT

best runtime candidate: NONE meeting acceptance
  exploratory best observed arm: provider=google-vertex + reasoning.effort=low + max_tokens=absent + temperature=0.7
  length median: 2704
  min: 1702
  max: 4070
  max/min: 2.39
  collapse rate: 1/3
  canon / fidelity / scene / dialogue / replay: not production-gated this phase;
    short samples remain scene-capable Korean RP prose (not empty/shallow stubs);
    CURRENT_INPUT_REPLAY signals still present on some cells (out of scope for D5-B fix)

production changes: 0
LLM calls total: 12
  B0: 0
  B1: 6
  B2: 0
  B3: 3
  TEMP: 3
  confirmation: 0

final: GEMINI_RUNTIME_STABILITY_NOT_SOLVED

production wire: NOT_RUN
merge: NOT_RUN

STOP.
```

## Interpretation (runtime only)

1. **Provider isolation** does not remove the 600–3000자 swing; both Vertex and AI Studio still collapse.
2. **Reasoning effort** cannot be lowered further under official OpenRouter metadata (`supported_efforts` ends at `low`; `none`/`minimal` unsupported; reasoning mandatory).
3. **Explicit `max_tokens=8192`** does not prevent early `stop` shorts; when reasoning is large it can hit `finish_reason=length` and truncate visible prose — not a stability fix.
4. **Temperature 0.7** is the only directional runtime lever among tested arms, but still fails min/median/variance gates.
5. Intrinsic **sampling variance** under production creative settings remains the dominant unexplained factor for length instability.

Next phase (not this PR): structural context packaging for replay/recital/dialogue **after** a separate canary decision — or accept Gemini length variance as model-intrinsic and design product recovery outside prompt wording.
