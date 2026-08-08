# Adult Handoff Style Fidelity Audit — DeepSeek V4 Pro vs Muse Spark 1.2

## Status

```text
ADULT_HANDOFF_FIDELITY_CAPTURE_COMPLETE
HUMAN_BLIND_REVIEW_COMPLETE
HIDDEN_MAP_REVEALED
PRODUCT_VERDICT = MIXED_PRODUCTION_HANDOFF_RESULT / NO_REPLACEMENT / KEEP_CURRENT_ADULT_MODEL
comparison_unit: PRODUCTION_CONFIG_BUNDLE_COMPARISON
FINAL_PROMPT_BYTE_PARITY = EXPECTED_DIFFERENCE
PRODUCTION_ADAPTER_MANIFEST = RECORDED
REQUIRED_PARITY = PASS (all 3 sources)
STAGE1_CALLS = 6
retry / continuation / recovery / fallback = 0
HUMAN_SCORES_SEALED_BEFORE_MAP_REVEAL = true
HUMAN_SCORES_SHA256 = 2f15d973693824f18c6f91848119b703a97e034abae646c1045dc5f58e3038f0
HIDDEN_MAP_SEAL_VERIFIED = true
API_CALLS_THIS_STEP = 0
production / Railway / pricing / DB / adult routing change = NO
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

## Blind + reveal summary

| Source | Formal PASS | Blind winner | Revealed model |
|---|---|---|---|
| Opus 5 | YES | X | Muse Spark 1.2 |
| GPT-5.6 Terra | YES | Y | DeepSeek V4 Pro |
| Gemini 3.1 Pro | NO | X | Muse Spark 1.2 |

```text
raw wins: Muse 2 / DeepSeek 1
human-approved-only: Muse 1 / DeepSeek 1
switch noticeability mean: Muse 1.70 = DeepSeek 1.70
→ MIXED_PRODUCTION_HANDOFF_RESULT / NO_REPLACEMENT
```

## Next step

Final T1→T4 live smoke on **current production adult model (DeepSeek V4 Pro)**. No Muse replacement activation. No additional bakeoff.

## Files

- `PREFLIGHT.json`
- `PROMPT_PARITY.json` / `PROMPT_PARITY.md`
- `SOURCE_ANCHORS.md`
- `RUNTIME_RESULTS.json` / `STAGE1_CALLS.json`
- `BLIND_REVIEW_PACKET.md`
- `HUMAN_SCORES.md`
- `HIDDEN_MAP.json` (revealed)
- `HIDDEN_MAP_REVEAL.md`
- `FINAL_VERDICT.md`
- `HUMAN_REVIEW.md`
- Private scores (gitignored): `data/human-review/adult-handoff-style-fidelity-muse12/`

Live raw captures also under `/opt/cursor/artifacts/adult-handoff-style-fidelity/`.
