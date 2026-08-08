# RP Quality Phase D — Status

```text
PHASE          : D (Quality Harness V2 + Continuity Audit + Gemini grounding audit)
BRANCH         : cursor/rp-quality-v2-gemini-grounding-6a91
BASE           : origin/main @ 8fbecbf
D0             : PASS (API=0)
D1             : READY_NOT_STARTED (needs G5/G6 live for replay class)
ADAPTER        : NOT_BUILT (candidate text only in taxonomy doc)
PRODUCTION     : UNCHANGED
C2-S / C3      : NOT_RUN (stopped)
```

## Delivered (D0)

- `src/lib/rpQualityVector/` — Quality Vector V2 + continuity auto audit
- Human schemas: recital, continuity (incl. INTRO_REPLAY / TURN1_REPLAY_ON_TURN2 / FIRST_TURN_SPECIAL_TREATMENT), quality-gate scores
- Retroactive scan of C2 (12) + C2-R (8) stored live outputs
- Docs under `docs/audits/rp-quality-v2-gemini/`

## Continuity principle (binding for D1+)

```text
PRIOR CANON / MEMORY / RECENT SCENE = STATE
NOT source text to re-output

REMEMBER IT · DO NOT REPLAY IT · ACT FROM IT
```

Allowed: short reference → new judgment/reaction.  
Forbidden: rewind / retell / re-enact completed user input.

## Next (D1) — not executed this seal

1. Run Fixture G5 + G6 minimal matrix (Gemini 3.1 Pro + DeepSeek V4 Pro)
2. Score SETTING_RECITAL + RECENT_SCENE_REPLAY + CURRENT_INPUT_REPLAY (+ G5/G6 keys)
3. Classify `REPLAY_IS_COMMON` vs `REPLAY_IS_GEMINI_HEAVY`
4. Only if Gemini-heavy recital/replay: draft `[GEMINI SCENE CONTINUITY]` adapter candidate
5. Hard gate: recital/replay ↓ while ACTIVE_CANON_USE / fidelity / progression / length ≥ baseline

## Hard quality gate reminder

```text
RECITAL ↓  but  ACTIVE_CANON_USE ↓  = FAIL
```
