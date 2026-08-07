# Adult Handoff Style Fidelity Audit — DeepSeek V4 Pro vs Muse Spark 1.2

## Status

```text
ADULT_HANDOFF_FIDELITY_AUDIT_PHASE_A
MUSE_12_ENDPOINT_AVAILABLE
DEEPSEEK_ENDPOINT_AVAILABLE
PRODUCTION_HANDOFF_PROMPT_PARITY_FAIL
LIVE_CALLS_NOT_RUN
HUMAN_BLIND_REVIEW_NOT_GENERATED
```

## Purpose

Single question: when Claude Opus 5 / GPT-5.6 Terra / Gemini 3.1 Pro hands off to an adult model (DeepSeek V4 Pro or Muse Spark 1.2), which adult model more naturally continues the source model's prose/rhythm/dialogue/character so that the model switch is less noticeable?

```text
STYLE HANDOFF FIDELITY
```

## Outcome

Both candidate endpoints are available (non-generation preflight PASS):
- DeepSeek V4 Pro — CheaperInference, `deepseek-v4-pro` present in `/v1/models`
- Muse Spark 1.2 — OpenRouter, `meta/muse-spark-1.2` present in `/api/v1/models` (400 models; both 1.1 and 1.2 listed)

However, the **prompt parity check FAILS**. The production adult handoff builder (`buildContext` + `appendAdultHandoffPrompt` + `assemblePrimaryRpRequest`) injects candidate-specific semantic/style adapters:

| Adapter | DeepSeek | Muse |
|---|---|---|
| XML system wrapping (`<PERSONA>` / `<WORLD_LORE>`) | YES | no |
| `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY` style reminder on user turn | YES | no |
| Compact future-instruction boundary | YES | no |
| Muse M1 prose style section | — | YES (model-gated) |

These are real production architecture differences. Per audit §7, a fair blind comparison requires the two candidates to be byte-equivalent except for model ID / provider transport fields. They are not. The adapters were **NOT removed** to fake parity.

```text
PRODUCTION_HANDOFF_PROMPT_PARITY_FAIL
LIVE_CALLS_NOT_RUN
```

The 6 planned live calls (3 sources × 2 candidates) were **not run**. No blind review packet was generated. No hidden map was created.

## Constraints honored

```text
production adult model change = NO
ADULT_MODEL_ID change = NO
Railway env change = NO
public picker change = NO
pricing change = NO
DB migration = NO
production DB write = NO
main RP prompt change = NO
merge = NO
deploy = NO
new source model calls (Opus/Terra/Gemini) = 0
provider fallback = 0
adapter deletion to fake parity = NO
```

## Files

- `PREFLIGHT.json` — non-generation endpoint availability check
- `PROMPT_PARITY.json` / `PROMPT_PARITY.md` — production handoff prompt parity check (FAIL)
- `SOURCE_ANCHORS.md` — source anchor candidates identified (not consumed; calls not run)
- `RUNTIME_RESULTS.json` — NOT_RUN status
- `scripts/adult-handoff-style-fidelity-preflight.ts` — preflight (no generation)
- `scripts/adult-handoff-style-fidelity-parity.ts` — parity check (no generation)

## Next step

A fair blind comparison requires either:
1. A production change to make the adult handoff prompt model-agnostic (out of scope for this audit — production change is forbidden), OR
2. A separate, explicitly-authorized diagnostic mode that builds a common prompt for both candidates (would require removing production adapters — explicitly forbidden by §7 as "fake parity").

Neither is authorized here. The audit stops at the parity gate. The model-selection question cannot be answered fairly under the current production architecture.

Awaiting direction. No merge, no deploy.
