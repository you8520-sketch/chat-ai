# FINAL REPORT — Gemini 3.1 Pro Sep-17 length/density 2×2 bisect

## EXACT MAIN

`45d79ca86fc7083fb4f590671a88d666ba6cc2c5` (GPT-confirmed; investigation base)

## EXACT HEAD

Branch `cursor/gemini31-length-sep17-bisect-bf59` (investigation commits on top of EXACT MAIN).

## BEHIND_MAIN

At investigation start, local/main was **11 commits behind** `origin/main` (`70e5c0bf`). Delta is official-supply / visual-age only — `responseLength.ts` / `sceneExpansionPolicy.ts` unchanged vs EXACT MAIN.

## HISTORICAL DELTA

| Commit | Change |
|---|---|
| `bbb8cad1` (2026-09-17) | USER_TAIL: generative causal sentence → AI_CAST-first + `[B] … 분량 채우기` ban. NARRATIVE_DENSITY: broad fill materials → AI_CAST-first + `[B]` filler ban + callback rules. |
| `00455a22` (same day) | Dropped USER_TAIL duplicate-emotion clause; slimmed density callback text (later deferred to COMMON PROSE). AI_CAST / B restrictions remain in current USER_TAIL. |

Pre-Sep17 USER_TAIL generative clause:

> 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.

## OWNER MAP

| Owner | Live on Main RP wire? | Notes |
|---|---|---|
| Numeric 3,200 target | YES | Solely via `USER_TAIL_LENGTH_OWNER_SENTENCE` |
| USER_TAIL length | YES | Absolute user-turn tail |
| NARRATIVE_DENSITY | **NO** | `buildLengthInstruction()` → `""`; constant is dead on production path |
| COMMON PROSE | YES | Style owner; unchanged across arms |
| Collaborative / current-turn agency | YES | Canonical `[B]` authorship |
| Gemini 3.1 agency supplement | YES | Body/intent boundary only |
| Scene pacing / dialogue | YES | Arm V + layout |

**Duplicate ownership:** USER_TAIL clause `[B]의 새 직접 대사·중요 선택·중대 행동을 분량 채우기용으로 만들지 않는다` is already owned by collaborative agency (`noGodmodding.ts`). Classified **DUPLICATE OWNERSHIP inside LENGTH**. Density twin is also agency-echo but **not live-injected**.

Offline prompt hashes (`quiet_intimacy`):

| Arm | USER_TAIL | DENSITY | Hash prefix |
|---|---|---|---|
| A | current | absent | `727818ba4321` |
| B | old | absent | `40decc71f91c` |
| C | current | absent | `727818ba4321` (=A) |
| D | old | absent | `40decc71f91c` (=B) |

Wire params: `temperature=0.95`, `reasoning_effort=low`, `max_tokens` omitted, Gemini 3.1 Pro CI route, `provider_calls=1` per sample (20/20).

## A/B/C/D RAW DISTRIBUTION (`quiet_intimacy`, n=5 each)

| Arm | values | min | median | mean | max | ≥2700 | ≥3200 |
|---|---|---|---|---|---|---|---|
| A CURRENT | 1346,1128,1452,1414,1132 | 1128 | 1346 | **1294** | 1452 | 0 | 0 |
| B OLD LENGTH | 2956,1235,4098,1596,982 | 982 | 1596 | **2173** | 4098 | 2 | 1 |
| C OLD DENSITY | 652,1589,2267,1309,775 | 652 | 1309 | **1318** | 2267 | 0 | 0 |
| D OLD BOTH | 783,1207,801,823,685 | 685 | 801 | **860** | 1207 | 0 | 0 |

## REASONING-MATCHED DISTRIBUTION

Reasoning/completion share means: A **0.714**, B **0.703**, C **0.683**, D **0.703**.

All arms spend ~65–75% of completion tokens on reasoning. Long B outliers still have high reasoning share (Br3: 0.731 with 6859 reasoning / 9384 completion). **Reasoning allocation dominates regardless of USER_TAIL variant.**

Same-prompt control: D uses identical provider-bound prompt as B (`40decc71…`) yet collapses to max 1207 — stochastic provider behavior, not a clean owner effect.

## AGENCY REGRESSION COUNTS (heuristic + manual review)

| Metric (sum over 5) | A | B | C | D |
|---|---|---|---|---|
| user new dialogue invented | 0 | 0 | 0 | 0 |
| user major choice invented | 0 | 0 | 0 | 0 |
| user major action invented | 0 | 0 | 0 | 0 |

Manual read of all 20 raws: no invented `[B]` direct dialogue / consequential choice / major action used as pad. AI leaves handoff to user. **No agency regression from old USER_TAIL.**

## FILLER / REPETITION COUNTS (heuristic sums)

| Metric | A | B | C | D |
|---|---|---|---|---|
| repeated emotion clusters | 0 | 0 | 0 | 0 |
| micro-action filler | 1 | 0 | 1 | 1 |
| backstory/memory padding | 5 | 8 | 5 | 5 |
| unnecessary NPC/event | 0 | 0 | 0 | 0 |
| abstract explanation | 0 | 0 | 0 | 0 |

B’s longer samples expand AI observation / atmosphere / psychology (aligned with old generative clause). Memory refs mostly echo injected LTM (3년 전 / 그림자) — not a new pad mode. No material filler explosion.

## WINNER / NO WINNER

**NO WINNER for MUST-FIX.**

- B mean > A (+879) and has 2/5 ≥2700, but median lift is modest (+250) and **3/5 B samples remain <1600**.
- C ≡ A on hash; distribution matches A (short) — density not isolable on current wire.
- D ≡ B on hash but **worse than A** — old USER_TAIL does not reliably restore long-output distribution.
- Combined (D) does **not** beat B/C/A.

## ROOT CAUSE

**ROOT_CAUSE_UNCONFIRMED**

| Candidate | Verdict |
|---|---|
| USER_TAIL Sep-17 | Weak / noisy positive signal only — **not proven** |
| NARRATIVE_DENSITY Sep-17 | **Cannot be current-path contributor** (not live-injected) |
| COMBINED | No |
| Provider/runtime (reasoning share) | Primary remaining candidate |

## SYSTEM DELTA

Investigation only:

- `scripts/gemini31-sep17-length-density-bisect.ts` (single-call 2×2 harness)
- `docs/audits/gemini31-sep17-length-density-bisect/**` (owner map, hashes, results, raws)

**Production prompt/runtime owners unchanged.**

## PRESERVED

- Main RP provider calls = 1 (proven per sample; total 20)
- No continuation / retry / recovery
- Gemini `reasoning_effort=low`, `temperature=0.95`, `max_tokens` omitted
- User agency / No Godmodding / COMMON PROSE / NSFW / memory / layout / billing / routing untouched

## PROOF

- Prompt hashes + wire params: `PROMPT_HASH_INDEX.json`, per-arm `prompt-meta.json`
- Live metas + raws: `quiet_intimacy/{A,B,C,D}/run{1..5}/`
- Aggregates: `DISTRIBUTION.json`, `RESULTS.json`, `SUMMARY_PROVIDER_CALLS.json`
- Artifact mirror: `/opt/cursor/artifacts/gemini31-sep17-length-density-bisect/`

## STOP CONDITIONS HIT

1. Arms remain similarly short in the modal case (A/C/D; majority of B).
2. Reasoning allocation dominates (~70%) across all prompt variants.
3. Same-prompt D collapse falsifies reliable USER_TAIL recovery.
4. Density arm is a no-op on current injection topology.

**Second gate (casual_banter / tension_action): NOT RUN** — no meaningful reliable winner.

**Production fix: NOT APPLIED** — evidence insufficient for MUST FIX NOW.
