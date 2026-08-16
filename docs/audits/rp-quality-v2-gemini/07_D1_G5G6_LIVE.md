# 07_D1_G5G6_LIVE

API calls (D1 total): **6** (G5×2 + G6×4)

## Classification

```json
{
  "CURRENT_INPUT_REPLAY_ON_FIRST_REACTION": "REPLAY_IS_GEMINI_HEAVY (offline T: Gemini 4/10 vs DeepSeek 1/10 auto; live G6_T1 Gemini=2 human)",
  "INTRO_REPLAY_G5": "REPLAY_IS_GEMINI_HEAVY_THIS_SEED (Gemini_G5 INTRO=2+SETTING=2; DeepSeek_G5 INTRO=1)",
  "TURN1_REPLAY_ON_TURN2_G6": "NOT_SEVERE_EITHER_MODEL_THIS_SEED (Gemini=1, DeepSeek=0)",
  "overall": "MIXED — first-turn intro/input restage Gemini-heavier; multi-turn scene rewind not reproduced"
}
```

## Human scores (spot seal)

| Cell | INTRO | INPUT | T1→T2 | SETTING | SCENE_ADV | notes |
|------|------:|------:|------:|--------:|----------:|-------|
| Gemini_G5 | 2 | 1 | — | 2 | 1 | Restages greeting shutter/ruins; persona dump (“호기심…직설적”); delayed advance |
| DeepSeek_G5 | 1 | 0 | — | 0 | 2 | Short silence→gun→pull; good continuity but DENSITY_COLLAPSE length |
| Gemini_G6_T2 | — | 1 | 1 | 1 | 2 | Continues scope/horror as ongoing STATE; no full turn1 rewind |
| DeepSeek_G6_T2 | — | 1 | 0 | 0 | 2 | Answers where-to without retelling turn1 |
| Gemini_G6_T1 | — | 2 | — | 1 | 2 | Opening restages user scream/metal-friction beat (cinema) |
| DeepSeek_G6_T1 | — | 1 | — | 0 | 2 | Opens on reaction/listen; lighter input restage |

## Adapter

```json
{
  "status": "CANDIDATE_TEXT_ONLY_NOT_WIRED",
  "reason": "Gemini repeatedly elevated on SETTING_RECITAL + CURRENT_INPUT_REPLAY / INTRO_REPLAY on first reaction; TURN1→T2 rewind not severe enough alone. Do not ship without A/B hard gate.",
  "block_id": "GEMINI_SCENE_CONTINUITY",
  "mnemonic": "REMEMBER IT · DO NOT REPLAY IT · ACT FROM IT",
  "must_not_become": [
    "회상 금지",
    "과거 언급 금지",
    "설정 언급 금지"
  ],
  "hard_gate": "RECITAL/REPLAY ↓ while ACTIVE_CANON_USE / CHARACTER_FIDELITY / SCENE_PROGRESSION / LENGTH ≥ baseline"
}
```

Full JSON: `07_D1_G5G6_LIVE.json`
