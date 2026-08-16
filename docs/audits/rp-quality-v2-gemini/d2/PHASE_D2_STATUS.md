# PHASE_D2_STATUS

```text
{
  "latest_main": "b586a5bf7f506a8da3f6d3b9252ac0f1b82217c1",
  "branch": "cursor/rp-quality-v2-gemini-grounding-6a91",
  "commit": "6ca1be072eac8bc38c3618fc3b95de4175b5a7ec",
  "PR": "https://github.com/you8520-sketch/chat-ai/pull/275",
  "production_prompt": "UNCHANGED",
  "Gemini_adapter": {
    "A": "absent",
    "B": "candidate GEMINI_SCENE_CONTINUITY"
  },
  "adapter_estimated_tokens": 297,
  "RAW_outputs_committed": "YES",
  "Stage1_calls": "8 / STOP EARLY (no confirmation)",
  "G5": {
    "A_chars": 1500,
    "B_chars": 2672,
    "A_intro_replay": 2,
    "B_intro_replay": 1,
    "A_setting_recital": 2,
    "B_setting_recital": 1,
    "A_scene_advance": 2,
    "B_scene_advance": 2,
    "A_new_scene_value": "MEDIUM",
    "B_new_scene_value": "HIGH",
    "winner": "B (replay/scene) but A length also collapsed"
  },
  "G6-T1": {
    "A_chars": 2608,
    "B_chars": 658,
    "A_input_replay": 3,
    "B_input_replay": 1,
    "A_scene_advance": 2,
    "B_scene_advance": 2,
    "winner": "A (B HARD length fail 658)"
  },
  "G3": {
    "active_canon_A_B": "5/5",
    "character_fidelity_A_B": "5/5",
    "recital_A_B": "1/0",
    "winner": "TIE on canon (B shorter / density collapse)"
  },
  "G2": {
    "persona_parrot_A_B": "2/1",
    "knowledge_leak_A_B": "0/0",
    "active_canon_A_B": "4/4",
    "winner": "B slight (parrot↓) — both density collapse"
  },
  "dialogue_char_share_AB": {
    "G5": {
      "A": 0.068,
      "B": 0.0629
    },
    "G6T1": {
      "A": 0.1323,
      "B": 0.1945
    },
    "G3": {
      "A": 0.203,
      "B": 0.1966
    },
    "G2": {
      "A": 0.0814,
      "B": 0.1007
    }
  },
  "same_speaker_fragmentation_AB": {
    "G5": {
      "A": 2,
      "B": 0
    },
    "G6T1": {
      "A": 2,
      "B": 4
    },
    "G3": {
      "A": 4,
      "B": 2
    },
    "G2": {
      "A": 2,
      "B": 4
    }
  },
  "density_collapse": {
    "A": [
      "Gemini_G5_A",
      "Gemini_G3_A",
      "Gemini_G2_A"
    ],
    "B": [
      "Gemini_G6T1_B",
      "Gemini_G3_B",
      "Gemini_G2_B"
    ]
  },
  "completion": {
    "A": {
      "Gemini_G5_A": "FAIL",
      "Gemini_G6T1_A": "PASS",
      "Gemini_G3_A": "FAIL",
      "Gemini_G2_A": "FAIL"
    },
    "B": {
      "Gemini_G5_B": "PASS",
      "Gemini_G6T1_B": "FAIL",
      "Gemini_G3_B": "FAIL",
      "Gemini_G2_B": "FAIL"
    }
  },
  "agency_severe": {
    "A": 0,
    "B": 0
  },
  "confirmation": "NOT_RUN",
  "confirmation_calls": 0,
  "final": "GEMINI_SCENE_CONTINUITY_FAIL",
  "production_wire": "NOT_RUN",
  "DeepSeek": "NOT_RUN",
  "Opus": "NOT_RUN",
  "Terra": "NOT_RUN",
  "gates": {
    "g5ReplayImproved": true,
    "g5SceneOk": true,
    "g6ReplayImproved": true,
    "g3CanonOk": true,
    "g2LeakOk": true,
    "bHardLengthFails": [
      "Gemini_G6T1_B",
      "Gemini_G3_B",
      "Gemini_G2_B"
    ],
    "bRelativeLengthFails": [
      "G6T1"
    ],
    "knowledgeLeak": false,
    "agency": false
  },
  "classification_note": "Directional G5 replay↓ + G6 input-restage↓ observed, but B density-collapse / relative length regression (esp. G6T1_B=658) → FAIL. Do not accumulate patch sentences. Next: content-boundary / placement audit separately."
}
```

## Human scores (full RAW read)

| Cell | INTRO | INPUT | SETTING | CANON | FIDELITY | SCENE | NEW_VALUE | COMPLETION |
|------|------:|------:|--------:|------:|---------:|------:|----------:|:----------:|
| Gemini_G5_A | 2 | 1 | 2 | 3 | 4 | 2 | MEDIUM | FAIL |
| Gemini_G5_B | 1 | 1 | 1 | 4 | 4 | 2 | HIGH | PASS |
| Gemini_G6T1_A | 0 | 3 | 1 | 4 | 4 | 2 | MEDIUM | PASS |
| Gemini_G6T1_B | 0 | 1 | 0 | 3 | 4 | 2 | LOW | FAIL |
| Gemini_G3_A | 0 | 1 | 1 | 5 | 5 | 2 | HIGH | FAIL |
| Gemini_G3_B | 0 | 1 | 0 | 5 | 5 | 2 | MEDIUM | FAIL |
| Gemini_G2_A | 1 | 1 | 1 | 4 | 4 | 2 | MEDIUM | FAIL |
| Gemini_G2_B | 0 | 1 | 1 | 4 | 4 | 2 | MEDIUM | FAIL |

## Verdict

**GEMINI_SCENE_CONTINUITY_FAIL** — confirmation NOT_RUN; production wire NOT_RUN.

Directional G5 replay↓ + G6 input-restage↓ observed, but B density-collapse / relative length regression (esp. G6T1_B=658) → FAIL. Do not accumulate patch sentences. Next: content-boundary / placement audit separately.
