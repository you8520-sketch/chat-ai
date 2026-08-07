# Adult Handoff Style Fidelity Audit — DeepSeek V4 Pro vs Muse Spark 1.2

## Status

```text
ADULT_HANDOFF_FIDELITY_AUDIT_PHASE_B
comparison_unit: PRODUCTION_CONFIG_BUNDLE_COMPARISON
MUSE_12_ENDPOINT_AVAILABLE
DEEPSEEK_ENDPOINT_AVAILABLE
FINAL_PROMPT_BYTE_PARITY = EXPECTED_DIFFERENCE
PRODUCTION_ADAPTER_MANIFEST = RECORDED
REQUIRED_PARITY = PASS (base/raw/continuity/generation)
STAGE1_LIVE = PENDING_OR_SEE_RUNTIME_RESULTS
```

## Product question

Not “which raw model is better on an identical prompt,” but:

```text
Under the current production adult handoff configuration bundles,
which of DeepSeek V4 Pro vs Muse Spark 1.2 more naturally continues
the source model's prose so the user notices the model switch less?
```

Results measure **actual production handoff bundle fidelity**, not pure raw-model performance.

## Comparison unit

```text
DeepSeek V4 Pro
+ production DeepSeek-specific prompt adaptations
+ production CheaperInference route
vs
Muse Spark 1.2
+ production Muse-specific prompt adaptations
+ production OpenRouter route
```

## Constraints honored

```text
production prompt change = NO
DeepSeek adapter removal = NO
Muse adapter removal = NO
main common prompt change = NO
candidate-specific new style/length/temp/RAW/continuity tuning = NO
production adult model / Railway / pricing / main merge / deploy = NO
source model calls (Opus/Terra/Gemini) = 0
retry / continuation / recovery / fallback = 0
common-prompt diagnostic = NOT_RUN (only if later approved)
```

## Required parity (must PASS before calls)

```text
BASE_CONTEXT_PARITY
RAW_HISTORY_PARITY
CURRENT_USER_INPUT_PARITY
CHARACTER_PERSONA_PARITY
CONTINUITY_DATA_PARITY
GENERATION_PARAMETER_PARITY  (shared: stream / target chars / max_tokens / stop)
```

```text
FINAL_PROMPT_BYTE_PARITY = EXPECTED_DIFFERENCE / NOT_REQUIRED
```

Production adapters recorded (not removed): DeepSeek XML wrapping, style reminder, compact boundary, CI temp 0.92/top_p 0.92; Muse OpenRouter temp 0.7 + mandatory minimal reasoning. Muse M1 style gate is exact `meta/muse-spark-1.1` only — **not** applied to 1.2 in current production.

## Stage 1 plan

```text
Opus source → DeepSeek 1 + Muse 1
Terra source → DeepSeek 1 + Muse 1
Gemini source → DeepSeek 1 + Muse 1
TOTAL = 6
```

Gemini anchor has no formal human PASS document — flagged in the packet; does not invalidate Opus/Terra.

After capture:

```text
ADULT_HANDOFF_FIDELITY_CAPTURE_COMPLETE
HUMAN_BLIND_REVIEW_REQUIRED
```

Hidden map stays sealed. No winner declaration before human blind review.

## Files

- `PREFLIGHT.json` — endpoint availability
- `PROMPT_PARITY.json` / `PROMPT_PARITY.md` — bundle fairness parity
- `SOURCE_ANCHORS.md` — reused source anchors
- `RUNTIME_RESULTS.json` — live capture status
- `BLIND_REVIEW_PACKET.md` — human blind review (after Stage 1)
- `HIDDEN_MAP.json` — sealed candidate identity map (do not open before review)
- `scripts/adult-handoff-style-fidelity-preflight.ts`
- `scripts/adult-handoff-style-fidelity-parity.ts`
- `scripts/adult-handoff-style-fidelity-stage1-live.ts`
