# D4-A Stage1 Live — Gemini positive forward length owner A/B

API calls this run: **6**

Variable: USER_TAIL_LENGTH_OWNER_SENTENCE only (REPLACE).
D2/D3 continuity block: NOT_USED.

RAW outputs: `docs/audits/rp-gemini-positive-forward-d4/d4a/raw/`

```json
{
  "phase": "D4-A",
  "model": "google/gemini-3.1-pro-preview",
  "api_calls_this_run": 6,
  "stage1_target": 6,
  "stage1_cells": 6,
  "d2_d3_continuity_block": "NOT_USED",
  "new_section_count": 0,
  "new_negative_directive_count": 0,
  "owner_token_delta": 35,
  "instruction_token_deltas": [
    {
      "fixture": "G5",
      "A": 6397,
      "B": 6432,
      "delta": 35
    },
    {
      "fixture": "G6T1",
      "A": 6453,
      "B": 6489,
      "delta": 36
    },
    {
      "fixture": "G3",
      "A": 6454,
      "B": 6489,
      "delta": 35
    }
  ],
  "raw_outputs_committed_path": "docs/audits/rp-gemini-positive-forward-d4/d4a/raw/",
  "confirmation": "NOT_RUN",
  "deepseek": "NOT_RUN",
  "opus": "NOT_RUN",
  "terra": "NOT_RUN",
  "production_prompt": "UNCHANGED",
  "production_wire": "NOT_RUN",
  "rows": [
    {
      "cell_id": "Gemini_G5_A",
      "visible_chars_no_ws": 3858,
      "length_band": "IDEAL",
      "dialogue_char_share": 0.0931,
      "hard_alarms": [],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0
    },
    {
      "cell_id": "Gemini_G5_B",
      "visible_chars_no_ws": 2037,
      "length_band": "STRONG_LENGTH_REGRESSION",
      "dialogue_char_share": 0.0962,
      "hard_alarms": [],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0
    },
    {
      "cell_id": "Gemini_G6T1_A",
      "visible_chars_no_ws": 1073,
      "length_band": "DENSITY_COLLAPSE",
      "dialogue_char_share": 0.1267,
      "hard_alarms": [
        "DENSITY_COLLAPSE",
        "CONTINUITY_REVIEW_REQUIRED",
        "CURRENT_INPUT_REPLAY_SIGNAL"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [
        "CURRENT_INPUT_REPLAY_SIGNAL"
      ],
      "agency_severe": 0
    },
    {
      "cell_id": "Gemini_G6T1_B",
      "visible_chars_no_ws": 661,
      "length_band": "DENSITY_COLLAPSE",
      "dialogue_char_share": 0.1815,
      "hard_alarms": [
        "DENSITY_COLLAPSE",
        "CONTINUITY_REVIEW_REQUIRED",
        "CURRENT_INPUT_REPLAY_SIGNAL"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [
        "CURRENT_INPUT_REPLAY_SIGNAL"
      ],
      "agency_severe": 0
    },
    {
      "cell_id": "Gemini_G3_A",
      "visible_chars_no_ws": 2388,
      "length_band": "STRONG_LENGTH_REGRESSION",
      "dialogue_char_share": 0.1302,
      "hard_alarms": [],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0
    },
    {
      "cell_id": "Gemini_G3_B",
      "visible_chars_no_ws": 4003,
      "length_band": "IDEAL",
      "dialogue_char_share": 0.1646,
      "hard_alarms": [],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0
    }
  ]
}
```
