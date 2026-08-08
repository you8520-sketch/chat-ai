# 04_RETROACTIVE_VALIDATION

API calls: **0**

```json
{
  "api_calls": 0,
  "c2_cells": 12,
  "c2r_cells": 8,
  "length_collapse_known_samples_detected": true,
  "incomplete_known_sample_detected": true,
  "current_input_replay_signals": [],
  "band_counts": {
    "STRONG_LENGTH_REGRESSION": 5,
    "DENSITY_COLLAPSE": 13,
    "REVIEW_REQUIRED": 2
  },
  "d0_checks": {
    "VISIBLE_LENGTH_METRICS": "PASS",
    "DIALOGUE_CHAR_SHARE": "PASS",
    "NARRATION_CHAR_SHARE": "PASS",
    "DIALOGUE_PARAGRAPH_SHARE_RENAMED": "PASS",
    "SAME_SPEAKER_FRAGMENT_METRICS": "PASS",
    "NARRATION_FRAGMENTATION": "PASS",
    "SETTING_RECITAL_EXACT_AUDIT": "PASS",
    "SETTING_RECITAL_HUMAN_SCHEMA": "PASS",
    "KNOWLEDGE_LEAK_HARD_GATE": "PASS",
    "CONTINUITY_REPLAY_METRICS": "PASS",
    "CONTINUITY_HUMAN_SCHEMA": "PASS"
  }
}
```

## Known hard failures

| Sample | Expected | Detected band |
|--------|----------|---------------|
| C2R/DeepSeek_T_M1 | DENSITY_COLLAPSE | DENSITY_COLLAPSE (769) |
| C2R/Gemini_T_A | DENSITY_COLLAPSE | DENSITY_COLLAPSE (380) |

DeepSeek_T_AB incomplete alarm: **PASS**

## Current-input replay auto signals

- (none on stored cells with available user fixture text)

Exact-overlap auto is weak on **paraphrase** restage. Human spot notes (D0 non-blocking):

- Gemini_T_A restages user scream/metal-friction beat as opening cinema
- Gemini_Q_A opens with long setting/atmosphere plane before reacting to kneel
- DeepSeek_T_A opens with reaction-to-sound (better continuity posture)

RECENT_SCENE_REPLAY auto: **not measurable** offline (no prior assistant stored with C2 cells) → needs Fixture G5/G6.

INTRA_TURN_REEXPLANATION auto: C2/DeepSeek_T_A

Cross-model class (`REPLAY_IS_COMMON` vs `REPLAY_IS_GEMINI_HEAVY`): **INCONCLUSIVE** until D1 G5/G6.

## Sanity

- length bands used: STRONG_LENGTH_REGRESSION, DENSITY_COLLAPSE, REVIEW_REQUIRED
- classifyLengthBand(380)=DENSITY_COLLAPSE
- D0 gate: see `06_D0_GATE.md` → **D0_PASS**
