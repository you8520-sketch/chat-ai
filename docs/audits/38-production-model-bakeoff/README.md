# 38 — Production prompt model bake-off

## Status

```text
MODEL_BAKEOFF_HUMAN_REVIEW_PENDING
DEEPSEEK_PROMPT_OPTIMIZATION_STOP
PR #245 CLOSED WITHOUT MERGE
```

## Goal

Stop DeepSeek prompt tuning. Compare **three live production prompt stacks** as-is (no compact contract, no structured palette, no DeepSeek SHORT HISTORY forced onto others).

## Representative models

See `MODEL_SELECTION.md`. Muse Spark is remapped and not live — slot B uses `claude-opus-5`.

| Slot | Model id |
| --- | --- |
| A | `gpt-5.6-terra` |
| B | `claude-opus-5` |
| C | `gemini-3.1-pro-preview` |

DeepSeek V4 Pro: reference arm only (prior `02-ds-pro-real-production` raws). **No new DeepSeek calls.**

## Conditions

- user 34 / character 18 / persona 61 / `single_primary`
- 2 chats × Turn1→Turn2 per model (4 valid outputs each)
- max 12 new calls (+ ≤1 runtime replacement call per model)
- auto detectors = alarms only (no auto PASS)

## Human review packet

| File | Purpose |
| --- | --- |
| `RAW_OUTPUTS_FULL.md` | Full labeled raws |
| `BLIND_MODEL_BAKEOFF.md` | Blind SIDE A/B/C |
| `_HIDDEN_MODEL_MAP.json` | Reveal map (after review) |
| `HARD_FAIL_ALARMS.json` | Detector alarms only |
| `RUNTIME_RESULTS.json` | Calls / exclusions / replacements |
| `PROMPT_HASHES.json` | Per-arm production stack hashes |

## Safety

```text
production DB apply: NO
general rollout: NO
auto merge: NO
auto deploy: NO
```
