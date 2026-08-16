# RP Quality Phase D — Status

```text
PHASE          : D (Quality Harness V2 + Continuity Audit + Gemini grounding audit)
BRANCH         : cursor/rp-quality-v2-gemini-grounding-6a91
BASE           : origin/main @ 8fbecbf
PR             : https://github.com/you8520-sketch/chat-ai/pull/275 (draft)
D0             : PASS (API=0)
D1             : PARTIAL_SEAL (G5×2 + G6×4 live; human spot scores)
ADAPTER        : CANDIDATE_TEXT_ONLY_NOT_WIRED
PRODUCTION     : UNCHANGED
C2-S / C3      : NOT_RUN (stopped)
```

## Delivered

### D0
- `src/lib/rpQualityVector/` — length, composition, fragmentation, setting overlap, continuity
- Retroactive C2 (12) + C2-R (8) with greeting-aware G5 offline
- Docs `00`–`06`

### D1
- Live G5 + G6 minimal matrix (Gemini 3.1 Pro + DeepSeek V4 Pro) — **6 API calls**
- Artifacts: `/opt/cursor/artifacts/rp-quality-d1-g5g6/live/`
- Sealed: `07_D1_G5G6_LIVE.*`, `08_GEMINI_SCENE_CONTINUITY_CANDIDATE.md`

## Continuity classification

```text
CURRENT_INPUT on first reaction (T / G6_T1): REPLAY_IS_GEMINI_HEAVY
INTRO_REPLAY G5 this seed:                 REPLAY_IS_GEMINI_HEAVY_THIS_SEED
TURN1_REPLAY_ON_TURN2 G6:                  NOT_SEVERE_EITHER_MODEL_THIS_SEED
OVERALL:                                   MIXED
```

## Adapter decision

Draft `[GEMINI SCENE CONTINUITY]` text only.  
**Not wired** into production prompt path. Requires A/B + hard gate:

```text
RECITAL/REPLAY ↓
while ACTIVE_CANON_USE / FIDELITY / PROGRESSION / LENGTH ≥ baseline
```

`RECITAL ↓` + `ACTIVE_CANON_USE ↓` = FAIL.

## Absolute stops still in force

- No production merge of Gemini adapter without human review + hard gate
- No C2-S / C3
- No shrinking canon content as first fix
- No merge of #271 / #273 / #274 into this branch
