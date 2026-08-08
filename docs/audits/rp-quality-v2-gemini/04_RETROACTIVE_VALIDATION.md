# 04_RETROACTIVE_VALIDATION

API calls: **0**

G5-style offline: greeting/intro from `fixtures/c*_fixture.json` passed as `greetingOrIntroText`.

```json
{
  "api_calls": 0,
  "c2_cells": 12,
  "c2r_cells": 8,
  "length_collapse_known_samples_detected": true,
  "incomplete_known_sample_detected": true,
  "current_input_replay_signals": [
    "C2/Gemini_T_A",
    "C2/Gemini_T_B",
    "C2R/DeepSeek_T_A",
    "C2R/Gemini_T_A",
    "C2R/Gemini_T_AB"
  ],
  "intro_or_recent_replay_signals": [],
  "replay_by_model": {
    "DeepSeek": {
      "input": 1,
      "intro": 0,
      "total": 10
    },
    "Gemini": {
      "input": 4,
      "intro": 0,
      "total": 10
    }
  },
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
    "CONTINUITY_HUMAN_SCHEMA": "PASS",
    "G5_OFFLINE_WITH_GREETING": "PASS"
  }
}
```

## Known hard failures

| Sample | Expected | Detected band |
|--------|----------|---------------|
| C2R/DeepSeek_T_M1 | DENSITY_COLLAPSE | DENSITY_COLLAPSE (769) |
| C2R/Gemini_T_A | DENSITY_COLLAPSE | DENSITY_COLLAPSE (380) |

DeepSeek_T_AB incomplete alarm: **PASS**

## CURRENT_INPUT_REPLAY auto signals

- C2/Gemini_T_A
- C2/Gemini_T_B
- C2R/DeepSeek_T_A
- C2R/Gemini_T_A
- C2R/Gemini_T_AB

## INTRO / RECENT_SCENE replay auto signals

- (none)

## Cross-model (auto, advisory)

```json
{
  "DeepSeek": {
    "input": 1,
    "intro": 0,
    "total": 10
  },
  "Gemini": {
    "input": 4,
    "intro": 0,
    "total": 10
  }
}
```

Human seal still required for `REPLAY_IS_COMMON` vs `REPLAY_IS_GEMINI_HEAVY`.

## Sanity

- length bands used: STRONG_LENGTH_REGRESSION, DENSITY_COLLAPSE, REVIEW_REQUIRED
- classifyLengthBand(380)=DENSITY_COLLAPSE
- D0 gate: see `06_D0_GATE.md`
