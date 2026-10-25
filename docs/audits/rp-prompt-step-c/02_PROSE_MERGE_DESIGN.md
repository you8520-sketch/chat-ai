# 02_PROSE_MERGE_DESIGN

**Status:** DESIGN ONLY — no production code changes in STEP C1.  
**C2 live:** NOT_RUN

## Goal

Compress the prose-style / immersive quality-floor bundle while preserving the K1–K15 KEEP meanings and model distinctiveness.

```text
COMMON PROSE = quality floor only
MODEL = actual stylistic generator
```

Do **not** add Opus-only “write more literarily” instructions.

## Current footprint (baseline freeze)

| Owner | est tokens |
|---|---:|
| `buildAdvancedProseNsfwGuidelines({nsfwEnabled:false})` | 1572 |
| `buildAdvancedProseNsfwGuidelines({nsfwEnabled:true})` | 1709 |

Cache class: **cacheCharacter** (OpenRouter) — savings help cache write/size more than uncached per-turn cost.

## KEEP meanings (K1–K15)

| id | meaning |
|---|---|
| K1 | narrator register = 해체 |
| K2 | 번역투 / 명사 파편 / 쉼표 나열 억제 |
| K3 | 같은 시작형 반복 억제 |
| K4 | short fragments only for real emphasis |
| K5 | sensation concrete and selective |
| K6 | stick to current focal character experience |
| K7 | no action/prop inventory lists |
| K8 | do not re-explain already-revealed emotion/relationship as abstract answer-key |
| K9 | dialogue fits character/relationship |
| K10 | no setting-briefing dialogue |
| K11 | no unjustified question spam |
| K12 | no unjustified first-meeting special treatment (canon/relationship/event exceptions) |
| K13 | quiet scenes must not close as summary |
| K14 | recent style is reference only — do not mimic prior response length |
| K15 | NSFW keeps character voice / relationship |

## Merge candidates (max two future arms)

### C2-M — MERGE ONLY

Same semantic coverage, fewer words. Candidate merges only true duplicates:

| id | merge | note |
|---|---|---|
| M1 | 번역투 단문 연속 금지 + 짧은 문장/파편 습관적 연타 금지 | same habit family |
| M2 | SCENE FLOW “평온한 장면 요약 금지” + IMMERSIVE “평온한 장면도 변화로 전개” | same quiet-scene anti-summary |
| M3 | “이미 잡힌 생각/관계 결론 반복 증명” vs “이미 드러난 감정/관계 의미 정답 해설” | **not** full duplicates — do not force one sentence if information is lost |

### C2-S — MERGE + WEBNOVEL BREATH soften

Starts from C2-M, then treats:

```text
중요 순간 직전: 지문 한 박 pause
전환·분기: 공간·시간·분위기 한 줄 reset
```

as `SOFTEN_CANDIDATE` only. Validate in a **separate** A/B from MERGE-only. Do not delete in the first C2 candidate without evidence.

## Token targets (quality > number)

| arm | target est tokens | vs ~1709 NSFW bundle |
|---|---:|---|
| C2-M | ~1200–1450 | ~250–500 reduction |
| C2-S stretch | ~1050–1300 | ~400–650 reduction |

## Future A/B rules (when authorized)

1. One variable at a time: C2-M first; C2-S only if C2-M non-inferior.
2. Offline semantic matrix for K1–K15 before any live call.
3. Protect all non-prose owners (layout result from C1, Arm E, agency, hygiene, terminals).
4. Human blind review is quality authority; auto metrics = format/leak/agency alarms only.
5. Even on ACCEPT: production prose replace = NOT_RUN until human approval.

## Out of scope for C2 design

- Model-specific giant prose forks
- New stylistic policies disguised as compression
- Touching CANON / SCOPE / KNOWLEDGE (`openrouter-korean-prose-top`)
