# D3 Stage1 Live — Gemini Context-Boundary A/C

API calls this run: **6**

T = historical D2 terminal (not re-called).

RAW: `docs/audits/rp-quality-v2-gemini/d3/raw/`

```json
{
  "phase": "D3",
  "model": "google/gemini-3.1-pro-preview",
  "api_calls_this_run": 6,
  "stage1_target": 6,
  "stage1_cells": 6,
  "wording_sha256": "0646850abc442dd6fb79b805df9eac6ca05c9a53506b675d0b607c4eff18f09e",
  "adapter_estimated_tokens": 297,
  "t_live": "NOT_RUN_HISTORICAL",
  "raw_outputs_committed_path": "docs/audits/rp-quality-v2-gemini/d3/raw/",
  "confirmation": "NOT_RUN",
  "deepseek": "NOT_RUN",
  "opus": "NOT_RUN",
  "terra": "NOT_RUN",
  "production_prompt": "UNCHANGED",
  "rows": [
    {
      "cell_id": "Gemini_G6T1_A",
      "placement": "absent",
      "visible_chars_no_ws": 2130,
      "length_band": "STRONG_LENGTH_REGRESSION",
      "dialogue_char_share": 0.1789,
      "hard_alarms": [],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0
    },
    {
      "cell_id": "Gemini_G6T1_C",
      "placement": "context_boundary",
      "visible_chars_no_ws": 708,
      "length_band": "DENSITY_COLLAPSE",
      "dialogue_char_share": 0.137,
      "hard_alarms": [
        "DENSITY_COLLAPSE"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0
    },
    {
      "cell_id": "Gemini_G5_A",
      "placement": "absent",
      "visible_chars_no_ws": 3384,
      "length_band": "IDEAL",
      "dialogue_char_share": 0.0561,
      "hard_alarms": [],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0
    },
    {
      "cell_id": "Gemini_G5_C",
      "placement": "context_boundary",
      "visible_chars_no_ws": 1919,
      "length_band": "STRONG_LENGTH_REGRESSION",
      "dialogue_char_share": 0.1548,
      "hard_alarms": [],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0
    },
    {
      "cell_id": "Gemini_G3_A",
      "placement": "absent",
      "visible_chars_no_ws": 2689,
      "length_band": "REVIEW_REQUIRED",
      "dialogue_char_share": 0.0967,
      "hard_alarms": [],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0
    },
    {
      "cell_id": "Gemini_G3_C",
      "placement": "context_boundary",
      "visible_chars_no_ws": 1759,
      "length_band": "DENSITY_COLLAPSE",
      "dialogue_char_share": 0.191,
      "hard_alarms": [
        "DENSITY_COLLAPSE"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0
    }
  ]
}
```
