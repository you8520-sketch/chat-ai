# 05 — Fixtures G5 / G6 (Intro & Turn continuity)

**Status:** SPEC READY — live execution is D1+ (not part of D0 API=0)  
**Purpose:** Measure RECENT_SCENE_REPLAY / CURRENT_INPUT_REPLAY where stored C2/C2-R cells lack prior-assistant context.

## Fixture G5 — GREETING / INTRO → USER TURN 1

```text
GREETING / INTRO
→ 이미 중요한 사건 또는 캐릭터 반응 발생

USER TURN 1
→ 짧은 반응/질문
```

### Required measures

| Key | Source |
|-----|--------|
| INTRO_REPLAY | Continuity human 0–3 |
| CURRENT_INPUT_REPLAY | Continuity human 0–3 |
| SETTING_RECITAL | Recital aggregate / sub-scores |
| FIRST_TURN_SPECIAL_TREATMENT | Continuity human 0–1 |
| SCENE_ADVANCEMENT | Continuity human 0–2 |

Also record Quality Vector V2 (length, composition, fragmentation).

### Minimal live matrix (D1)

```text
Gemini 3.1 Pro × G5 × 1–2 seeds
DeepSeek V4 Pro × G5 × 1 seed   # cross-model, not ranking
```

Reuse Opus/Terra stored outputs for the same fixture if present — **no API re-call**.

## Fixture G6 — TURN1 → TURN2

```text
TURN 1 assistant에서 사건 발생
→ TURN 2 user는 짧게 반응
```

### Required measures

| Key | Source |
|-----|--------|
| TURN1_REPLAY_ON_TURN2 | Continuity human 0–3 |

Auto assist: pass turn1 assistant text as `priorAssistantText` into `computeContinuityAutoAudit`.

### Minimal live matrix (D1)

```text
Gemini 3.1 Pro × G6 × 1–2 seeds
DeepSeek V4 Pro × G6 × 1 seed
```

## Classification goal (not ranking)

```text
REPLAY_IS_COMMON
vs
REPLAY_IS_GEMINI_HEAVY
```

## Allowed vs forbidden reference (both fixtures)

Allowed short callbacks that create **new** change:

```text
“아까 들은 비명과 같은 방향이었다.”
“조금 전의 낯익음이 이번에는 확신에 가까워졌다.”
```

Forbidden: retelling the prior scene from the top for the reader.
