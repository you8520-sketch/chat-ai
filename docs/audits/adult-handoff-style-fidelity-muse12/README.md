# Adult Handoff Style Fidelity Audit — DeepSeek V4 Pro vs Muse Spark 1.2

## Status

```text
ADULT_HANDOFF_FIDELITY_CAPTURE_COMPLETE
HUMAN_BLIND_REVIEW_REQUIRED
comparison_unit: PRODUCTION_CONFIG_BUNDLE_COMPARISON
FINAL_PROMPT_BYTE_PARITY = EXPECTED_DIFFERENCE
PRODUCTION_ADAPTER_MANIFEST = RECORDED
REQUIRED_PARITY = PASS (all 3 sources)
STAGE1_CALLS = 6
retry / continuation / recovery / fallback = 0
winner_declared = false
hidden_map = SEALED
```

## Product question

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

## Stage 1 capture

| Source | DeepSeek | Muse | Required parity |
|---|---|---|---|
| Opus 5 (Arm E, human PASS) | 1 call, finish=stop | 1 call, finish=stop | PASS |
| GPT-5.6 Terra (human PASS) | 1 call, finish=stop | 1 call, finish=stop | PASS |
| Gemini 3.1 Pro (no formal PASS doc) | 1 call, finish=stop | 1 call, finish=stop | PASS |

Gemini limitation is recorded; it does **not** invalidate Opus/Terra cells.

## Blind review

1. Score `BLIND_REVIEW_PACKET.md` (source visible, candidate identity hidden).
2. Emphasize MODEL_SWITCH_NOTICEABILITY + SAME_AUTHOR_ILLUSION with totals.
3. Only then open `HIDDEN_MAP.json`.
4. Apply product verdict rules in `HUMAN_REVIEW.md`.

Do not declare a winner before human blind review.

## Constraints honored

```text
production prompt change = NO
DeepSeek / Muse adapter removal or retune = NO
main common prompt change = NO
candidate-specific temp/RAW/continuity overrides = NO
production adult model / Railway / pricing / main merge / deploy = NO
source model calls = 0
common-prompt diagnostic = NOT_RUN
```

## Files

- `PREFLIGHT.json`
- `PROMPT_PARITY.json` / `PROMPT_PARITY.md`
- `SOURCE_ANCHORS.md`
- `RUNTIME_RESULTS.json` / `STAGE1_CALLS.json`
- `BLIND_REVIEW_PACKET.md`
- `HIDDEN_MAP.json` (sealed)
- `HUMAN_REVIEW.md`
- `scripts/adult-handoff-style-fidelity-preflight.ts`
- `scripts/adult-handoff-style-fidelity-parity.ts`
- `scripts/adult-handoff-style-fidelity-stage1-live.ts`

Live raw captures also under `/opt/cursor/artifacts/adult-handoff-style-fidelity/`.
