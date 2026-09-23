# D2 Stage1 Live — Gemini Scene Continuity A/B

API calls this run: **8**

RAW outputs: `docs/audits/rp-quality-v2-gemini/d2/raw/`

```json
{
  "phase": "D2",
  "model": "google/gemini-3.1-pro-preview",
  "api_calls_this_run": 8,
  "stage1_target": 8,
  "stage1_cells": 8,
  "adapter_estimated_tokens": 297,
  "raw_outputs_committed_path": "docs/audits/rp-quality-v2-gemini/d2/raw/",
  "confirmation": "NOT_RUN",
  "deepseek": "NOT_RUN",
  "opus": "NOT_RUN",
  "terra": "NOT_RUN",
  "production_prompt": "UNCHANGED",
  "rows": [
    {
      "cell_id": "Gemini_G5_A",
      "visible_chars_no_ws": 1500,
      "length_band": "DENSITY_COLLAPSE",
      "dialogue_char_share": 0.068,
      "hard_alarms": [
        "DENSITY_COLLAPSE"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0,
      "knowledge_leak": 0
    },
    {
      "cell_id": "Gemini_G5_B",
      "visible_chars_no_ws": 2672,
      "length_band": "REVIEW_REQUIRED",
      "dialogue_char_share": 0.0629,
      "hard_alarms": [],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0,
      "knowledge_leak": 0
    },
    {
      "cell_id": "Gemini_G6T1_A",
      "visible_chars_no_ws": 2608,
      "length_band": "REVIEW_REQUIRED",
      "dialogue_char_share": 0.1323,
      "hard_alarms": [
        "CONTINUITY_REVIEW_REQUIRED",
        "CURRENT_INPUT_REPLAY_SIGNAL"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [
        "CURRENT_INPUT_REPLAY_SIGNAL"
      ],
      "agency_severe": 0,
      "knowledge_leak": 0
    },
    {
      "cell_id": "Gemini_G6T1_B",
      "visible_chars_no_ws": 658,
      "length_band": "DENSITY_COLLAPSE",
      "dialogue_char_share": 0.1945,
      "hard_alarms": [
        "DENSITY_COLLAPSE"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0,
      "knowledge_leak": 0
    },
    {
      "cell_id": "Gemini_G3_A",
      "visible_chars_no_ws": 1123,
      "length_band": "DENSITY_COLLAPSE",
      "dialogue_char_share": 0.203,
      "hard_alarms": [
        "DENSITY_COLLAPSE"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0,
      "knowledge_leak": 0
    },
    {
      "cell_id": "Gemini_G3_B",
      "visible_chars_no_ws": 819,
      "length_band": "DENSITY_COLLAPSE",
      "dialogue_char_share": 0.1966,
      "hard_alarms": [
        "DENSITY_COLLAPSE"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0,
      "knowledge_leak": 0
    },
    {
      "cell_id": "Gemini_G2_A",
      "visible_chars_no_ws": 1633,
      "length_band": "DENSITY_COLLAPSE",
      "dialogue_char_share": 0.0814,
      "hard_alarms": [
        "DENSITY_COLLAPSE"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0,
      "knowledge_leak": 0
    },
    {
      "cell_id": "Gemini_G2_B",
      "visible_chars_no_ws": 1748,
      "length_band": "DENSITY_COLLAPSE",
      "dialogue_char_share": 0.1007,
      "hard_alarms": [
        "DENSITY_COLLAPSE"
      ],
      "review_flags": [
        "SPEAKER_SPLIT_REVIEW_REQUIRED"
      ],
      "continuity_alarms": [],
      "agency_severe": 0,
      "knowledge_leak": 0
    }
  ]
}
```
