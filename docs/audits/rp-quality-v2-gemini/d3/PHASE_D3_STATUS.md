# PHASE_D3_STATUS

```text
{
  "PHASE_D3_STATUS": true,
  "baseline_main": "268b8a70556f3392e7eb89283ba2e07689e2e332",
  "branch": "cursor/rp-gemini-content-boundary-d3-96c2",
  "commit": "dec576022c6b5929ca717c7d310417e1ed9e0b8f",
  "draft_PR": "https://github.com/you8520-sketch/chat-ai/pull/278",
  "D2_wording": "BYTE_IDENTICAL",
  "offline_owner_map": "PASS",
  "continuity_current_D2_placement": "SYSTEM_TAIL",
  "context_boundary_insertion_point": "immediately before [OUTPUT LAYOUT] / rule-output-layout-recency (src/lib/geminiSceneContinuityAdapter.ts insertGeminiSceneContinuityBeforeOutputLayout)",
  "length_owner_position": "user-tail USER_TAIL_LENGTH_OWNER_SENTENCE (src/lib/responseLength.ts)",
  "user_terminal_owner_position": "layout line + length sentence after [CURRENT USER INPUT] body",
  "Stage1_calls": 6,
  "G6-T1": {
    "A_chars": 2130,
    "C_chars": 708,
    "T_historical_chars": 658,
    "A_input_replay": 3,
    "C_input_replay": 1,
    "A_new_scene_value": "MEDIUM",
    "C_new_scene_value": "LOW",
    "replacement_content": "NO",
    "winner": "A (C length recovery FAIL)"
  },
  "G5": {
    "A_chars": 3384,
    "C_chars": 1919,
    "A_intro_replay": 2,
    "C_intro_replay": 1,
    "A_recital": 2,
    "C_recital": 1,
    "A_new_scene_value": "HIGH",
    "C_new_scene_value": "MEDIUM",
    "winner": "A (C relative length FAIL; replay directionally ok)"
  },
  "G3": {
    "A_active_canon": 5,
    "C_active_canon": 5,
    "A_fidelity": 5,
    "C_fidelity": 5,
    "A_recital": 1,
    "C_recital": 1,
    "A_chars": 2689,
    "C_chars": 1759,
    "winner": "TIE on canon (C density collapse)"
  },
  "density_collapse": {
    "A": [],
    "C": [
      "Gemini_G6T1_C",
      "Gemini_G3_C"
    ]
  },
  "completion": {
    "A": {
      "G6T1": "PASS",
      "G5": "PASS",
      "G3": "PASS"
    },
    "C": {
      "G6T1": "FAIL",
      "G5": "FAIL",
      "G3": "FAIL"
    }
  },
  "dialogue_char_share": {
    "G6T1": {
      "A": 0.1789,
      "C": 0.137
    },
    "G5": {
      "A": 0.0561,
      "C": 0.1548
    },
    "G3": {
      "A": 0.0967,
      "C": 0.191
    }
  },
  "same_speaker_fragmentation": {
    "G6T1": {
      "A": 2,
      "C": 2
    },
    "G5": {
      "A": 4,
      "C": 5
    },
    "G3": {
      "A": 2,
      "C": 2
    }
  },
  "confirmation": "NOT_RUN",
  "calls_confirmation": 0,
  "stop_reason": "G6 length recovery FAIL — stop further placement search",
  "final": "GEMINI_CONTEXT_BOUNDARY_PLACEMENT_FAIL",
  "classification_note": "PLACEMENT_NOT_SUFFICIENT — C still collapses length (G6 C≈D2 T); do not search more placements; next would be structural context packaging (NOT implemented in D3).",
  "production_wire": "NOT_RUN",
  "common_prompt": "UNCHANGED",
  "adapter_estimated_tokens": 297,
  "DeepSeek": "NOT_RUN",
  "Opus": "NOT_RUN",
  "Terra": "NOT_RUN",
  "numeric_diff": 0
}
```

## Human scores (full RAW read)

| Cell | INPUT | INTRO | SETTING | CANON | FIDELITY | SCENE | NEW_VALUE | REPLACE | FULL? | COMPLETION |
|------|------:|------:|--------:|------:|---------:|------:|----------:|:-------:|:-----:|:----------:|
| Gemini_G6T1_A | 3 | 0 | 1 | 4 | 4 | 2 | MEDIUM | N/A | YES | PASS |
| Gemini_G6T1_C | 1 | 0 | 0 | 4 | 4 | 1 | LOW | NO | NO | FAIL |
| Gemini_G5_A | 1 | 2 | 2 | 4 | 4 | 2 | HIGH | N/A | YES | PASS |
| Gemini_G5_C | 1 | 1 | 1 | 4 | 4 | 2 | MEDIUM | PARTIAL | NO | FAIL |
| Gemini_G3_A | 1 | 0 | 1 | 5 | 5 | 2 | HIGH | N/A | YES | PASS |
| Gemini_G3_C | 1 | 0 | 1 | 5 | 5 | 2 | MEDIUM | PARTIAL | NO | FAIL |

## Verdict

**GEMINI_CONTEXT_BOUNDARY_PLACEMENT_FAIL** — confirmation NOT_RUN; production wire NOT_RUN.

PLACEMENT_NOT_SUFFICIENT — C still collapses length (G6 C≈D2 T); do not search more placements; next would be structural context packaging (NOT implemented in D3).
