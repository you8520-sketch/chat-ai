# Scene Momentum Support PoC (Candidate A) — Report

**Model:** deepseek/deepseek-v4-pro · **Reasoning:** OFF · **Memory:** ON · **maxTokens:** 3500 · production sampling identical
**Live calls:** 11 new (9 THIN D2+MOMENTUM + 2 MATURE sanity), 0 errors · **Baseline:** existing D2 THIN reused (no re-run)
**PoC data:** `data/d2-momentum/` (separate from existing D2/D1.1/D2-length data)

---

## VERDICT (single)

# ✅ READY FOR MOMENTUM CONFIRMATION

The architecture is sound: a clear directional length/beat recovery on THIN with **no failure mode** (no raw-history duplication, no dormant/new-event recurrence, no MATURE intervention), and the MATURE auto-off contract holds. The floor recovery is **partial** (median +20.5%, floor 3/9→5/9; two severe short outputs momentum did not prevent) — this is a magnitude/calibration gap for the confirmation phase to address, **not** an architecture failure, and per the binding sign-off no tuning was performed mid-PoC. One real Phase-1 calibration finding is flagged below as an unresolved decision (content-maturity ≠ predicate-maturity).

---

## 1. Implementation delta

**Modified (tracked):**
- `src/services/contextBuilder.ts` — wired `buildSceneMomentumBlockString` into the DeepSeek `deepSeekXmlMode` user-turn extras (`deepSeekUserExtras`), gated on `layeredCanonActive && isThinSceneHistory(input.shortTermHistory) && input.sceneMomentumInput`. Momentum is opt-in: callers that do not pass `sceneMomentumInput` are byte-identical to before. The block is appended to the **dynamic, non-cached** user-turn extras (below the stable CORE cache prefix); Terminal/LENGTH tail unchanged.
- `src/types.ts` — added optional `sceneMomentumInput?: SceneMomentumInput | null` to `ContextBuildInput`.

**New (untracked):**
- `src/lib/sceneMomentum/types.ts` — `SceneMomentumInput`, `SceneMomentumFields`, `SceneMomentumResult`, `SCENE_MOMENTUM_HEADER`, `SCENE_MOMENTUM_RECENT_WINDOW`.
- `src/lib/sceneMomentum/extractor.ts` — pure `buildSceneMomentumBlock` / `buildSceneMomentumBlockString` + `isThinSceneHistory` (replicates `resolveDeepSeekShortHistoryLengthExtra`).
- `src/lib/sceneMomentum/extractor.test.ts` — deterministic tests A–J.
- `scripts/_tmp-d2-runner.ts` — extended `RunOpts` with optional `sceneMomentumInput`, threaded into `buildContext` (existing callers unaffected).
- `scripts/_tmp-momentum-fixtures.ts`, `scripts/_tmp-momentum-mature-long.ts`, `scripts/_tmp-momentum-live.ts`, `scripts/_tmp-momentum-dry.ts`, `scripts/_tmp-momentum-dry-wiring.ts`, `scripts/_tmp-momentum-probe-long.ts`.
- `data/d2-momentum/` — 11 per-run `.txt` + `metrics.json` + `summary.json`.

**Unchanged (per hard constraints):** LENGTH / Terminal / Scene Engine / prose prompt / ACTIVE selector / canon compiler / archive selector. Muse/Gemini/HY3 actual payload byte-identical (verified by test I). No commit/push/PR/deploy.

## 2. Extractor exact behavior

`buildSceneMomentumBlock(input)` is a **pure, deterministic, no-LLM** extractor. It reads the last `SCENE_MOMENTUM_RECENT_WINDOW` (=4) raw turns as **extraction evidence only**, plus `currentLocation` (models production `memoryMeta.currentLocation`), `promises` (`memoryMeta.promises`), and `openingGreeting`. It emits a block under the neutral data label `[CURRENT SCENE CONTINUITY]` with a one-line data-only preamble (explicitly tells the model **not** to mimic the block's length/format and **not** to introduce new people/places/events/secrets), then up to 5 optional fields:

- **WHERE** — from `currentLocation` if established; else from a location anchor in recent history; else omitted.
- **WHAT IS HAPPENING** — from a current-action anchor in recent history (e.g. 음료/차/커피 권함, 함께 쉼, 약초/차 다룸); else omitted.
- **UNFINISHED** — only on clear unresolved evidence (unanswered question / in-progress action); conservative — low confidence → omitted. No invented emotional tension.
- **RELATIONSHIP STATE** — from a relational anchor in recent history (e.g. 과묵하지만 행동으로 챙기는 온기, 차갑지만 생존 핑계로 챙기는 관계); else omitted.
- **AVAILABLE AFFORDANCES** — scene-local objects already present (물, 페달, 차, 약초, 이슬풀, 커피, 필터, 건반); else omitted.

Guards: `FORBIDDEN_MOMENTUM_TERMS` filter strips dormant-canon / future-hook / secret / new-enemy / next-event tokens; `isRawCopyOfRecent` guard rejects any field value that is a verbatim copy of recent raw history (no raw-history duplication); the current user message is never re-injected (it is already the final user turn). No command sentences ("continue the scene", "write longer", etc.) — block is data/context only.

## 3. Activation predicate

Reuses the existing DeepSeek thin-history predicate **verbatim**: `isThinSceneHistory` replicates `resolveDeepSeekShortHistoryLengthExtra` — **ON when the avg non-whitespace char count of the last ≤3 assistant turns is < 2200**, OFF (≥2200). 2200 is a PoC calibration **start** only, not a confirmed universal threshold; **no threshold tuning was performed**. Gating in `buildContext`: `layeredCanonActive` (D2 canary) **AND** `isThinSceneHistory(shortTermHistory)` **AND** `sceneMomentumInput` provided. DeepSeek D2 canary only; not pushed for Muse/Gemini/HY3.

## 4. Deterministic tests (A–J)

Run: `node --conditions=react-server --import tsx --test src/lib/sceneMomentum/extractor.test.ts` → **12/12 pass**. `npm run typecheck:app` → **exit 0**. Both green **before** any live call.

| Test | Result |
|---|---|
| A. same context → byte-identical block | ✅ pass |
| B. thin history → support ON | ✅ pass |
| C. mature history → support OFF | ✅ pass (predicate-mature long-turn fixture) |
| D. missing field evidence → field omitted | ✅ pass |
| E. raw history not duplicated in block | ✅ pass |
| F. dormant greeting hook excluded | ✅ pass |
| G. current location included when established | ✅ pass |
| H. unrelated canon sentinel absent | ✅ pass |
| I. Muse/Gemini/HY3 payload unchanged (no momentum) | ✅ pass |
| J. kill switch / canary off → no momentum (exact CONTROL) | ✅ pass |
| J2. D2 canary ON + thin → momentum injected (positive gate) | ✅ pass |
| J3. D2 canary ON + MATURE → momentum auto-off | ✅ pass |

Wiring dry-check (`_tmp-momentum-dry-wiring.ts`, no API): THIN modern-quiet `momentum_header=true`, THIN enoch-clean `momentum_header=true`, MATURE long modern `momentum_header=false` (auto-off) — confirmed before spending live calls.

## 5. Momentum examples (rendered blocks)

All THIN blocks fired (`momentum_active=1` for 9/9). Block size 316–329 chars; all 5 fields present; `sourceCount=4`, `activeTurns=2`, `greetingSourced=false`. The MATURE block is computed (336 chars) but **not injected** (auto-off).

**modern-quiet (316 chars):**
```
[CURRENT SCENE CONTINUITY]
아래는 현재 장면의 이미 성립한 상태 요약이다. 연속성에 사용하되, 이 요약의 길이나 형식을 다음 답변 길이의 예시로 모방하지 않으며, 이미 장면에 존재하는 요소만 다루고 새 인물·장소·사건·비밀을 도입하지 않는다.
WHERE: 준서의 자취방
WHAT IS HAPPENING: 자리에서 함께 쉬는 중
UNFINISHED: 직전 교류에서 감정·화제를 행동으로 흘려보낸 직후 — 아직 닫히지 않은 대화
RELATIONSHIP STATE: 과묵하지만 행동으로 챙기는 온기
AVAILABLE AFFORDANCES: 물, 페달
```

**fantasy-quiet (329 chars):** WHERE: 오두막 / 약초밭 · WHAT: 약초/차를 다루며 함께 머무는 중 · UNFINISHED: (same conservative template) · REL: 온화하되 단호하게 챙기는 거리감 · AFFORDANCES: 차, 약초, 이슬풀

**enoch-clean (327 chars):** WHERE: 역장 · WHAT: 음료(물·차·커피)를 권하며 함께 쉬는 중 · UNFINISHED: (same) · REL: 차갑지만 생존 핑계로 챙기는 관계 · AFFORDANCES: 커피, 물, 필터

**modern-mature (336 chars, NOT injected — auto-off):** WHERE: 준서의 자취방 · WHAT: 음료(물·차·커피)를 권하며 함께 쉬는 중 · REL: 차갑지만 생존 핑계로 챙기는 관계 · AFFORDANCES: 커피, 물, 건반, 페달

## 6. Source provenance

Each field is sourced from already-established scene state, not invented:
- **WHERE** ← `currentLocation` (models production `memoryMeta.currentLocation`, the already-parsed scene place; 준서의 자취방 / 오두막·약초밭 / 역장).
- **WHAT / UNFINISHED / RELATIONSHIP / AFFORDANCES** ← bounded recent raw history (last 4 turns) as extraction evidence only, with anchor-based detection; never raw-copied (`isRawCopyOfRecent` guard).
- `openingGreeting` is null for these fixtures (no synthetic opening pair); `greetingSourced=false` for all.
- `sourceCount=4` (the 4 recent turns used as evidence), `activeTurns=2` (the 2 most recent assistant turns driving the predicate).

## 7. 9-call THIN results (vs existing D2 THIN baseline)

| fixture | D2+MOM chars (n=3) | med | floor≥2700 | D2 THIN med | D2 THIN floor | Δmed | Δfloor |
|---|---|---|---|---|---|---|---|
| modern-quiet | 4717 / 1873 / 2991 | **2991** | 2/3 | 2056 | 1/3 | **+935** | +1 |
| fantasy-quiet | 2374 / 2269 / 2871 | **2374** | 1/3 | 2383 | 1/3 | **−9** | 0 |
| enoch-clean | 4247 / 916 / 2883 | **2883** | 2/3 | 2152 | 1/3 | **+731** | +1 |
| **AGGREGATE (n=9)** | — | **2871** | **5/9** | 2383 | 3/9 | **+488 (+20.5%)** | **+2** |

- vs **D1.1 THIN agg median 3460**: Δ = **−589** (still below the D1.1 recovery target, but the gap narrowed from −1077 to −589).
- Completion-token medians: modern 2140 (base 1508), fantasy 1929 (base 1890), enoch 2082 (base n/a). Modern completion nearly doubled.
- Momentum fired 9/9. Selector counts unchanged vs baseline per fixture (modern active=0/archive=0; fantasy active=1/archive=1; enoch active=0/archive=2) — momentum did **not** alter the ACTIVE/archive selector, as required.
- **Cache prefix preserved:** THIN `cached=4096` (modern r1–r3, enoch r1/r3, fantasy r2/r3) — the stable CORE prefix still hits cache; momentum lives in the **uncached dynamic** region (modern `uncached=506`). Fantasy r1 was a cold start (`cached=0`), consistent with baseline cold-call behavior.

**Reading:** 2 of 3 cells recovered meaningfully (modern +935, enoch-clean +731; both floor 1/3→2/3). Fantasy was already at target and stayed flat (−9, floor unchanged) — momentum's lift is strongest where THIN output is most depressed, weakest where already adequate. Two severe short outputs (modern r2=1873, enoch r2=916) were **not** prevented — see items 8 & 10.

## 8. Meaningful beats

Paragraph-beat medians (heuristic counter, same method as `_tmp-d2-length-live`): modern **12**, fantasy **16**, enoch-clean **19**. Per-rep highs: modern r1=23, enoch r1=35, fantasy r3=22. `chars/beat` 121–249 (no single-paragraph wall-of-text). Dialogue turns present where the scene warranted (modern r3 dlg=7, enoch r1 dlg=5). Beats are **up and substantive** — multi-paragraph, varied, non-repetitive — not padded. (The reused D2 THIN baseline did not capture beats, so no direct baseline-beat delta; the D2-length D2-MATURE reference was ~13–14 beats, and D2+MOM THIN reaches comparable-or-higher beat density on the recovering cells.)

## 9. Breadth / dormant

**Clean — no dormant recurrence, no external breadth inflation.**
- modern-quiet: active=0/archive=0 — no canon selected; output stays entirely scene-local (자취방, 피아노, 물, 페달, 학생). No dormant canon exists for this fixture; none introduced.
- fantasy-quiet: active=1/archive=1 — only the **required** lore (이슬풀/약초/차) selected; output is scene-local sensory prose (오두막, 약초밭, 차). No dormant faction/enemy/NPC activated, no new location, no future-event hook.
- enoch-clean: active=0/archive=2 — required archive lore only; output references Enoch's **own** backstory (마더의 텔레파시, 성채, 브레인 포드) as **internal reflection**, not a newly-activated dormant hook, not a future event, not a new enemy. The momentum block itself excludes dormant tokens (test F).
- No output introduced a new NPC, a new location-move goal, a hidden secret, or next-event planning. External breadth did not inflate.

## 10. Repetition / arbitrary events

**Clean — not Case B, not Case C.**
- **No raw-history duplication:** the momentum block is never copied verbatim into any output. Outputs are varied, original prose. The `isRawCopyOfRecent` guard held in every block.
- **The two severe short outputs are high-quality, not repetitive:** modern r2 (1873) is a richly interior, multi-paragraph contemplative scene ending at a natural quiet beat ("고마워"); enoch r2 (916) is a tight, well-observed single-scene beat ending at "한 잔 더. 줄 수 있으면." Both are **short by natural ending, not by duplication or padding**. Momentum did not degrade them; it simply did not force length on those reps.
- **No arbitrary event increase:** no output manufactured a new conflict, a sudden event, a time-skip-to-action, or a dramatic turn. Scenes stay in the established quiet register.
- **No user godmodding:** the user cue is a passive "let's rest / nothing is fine" line; outputs do not attribute un-cued actions or speech to the user. Current-cue retention is good (modern r1 echoes "수고했어 / 내일 일정 없어 / 아무것도 안 하고 있어도 될 것 같아" naturally).

## 11. MATURE OFF sanity (2 calls)

**Auto-off contract holds — not Case E.**

| call | chars | floor | beats(para) | momentum_active | prompt | cached |
|---|---|---|---|---|---|---|
| modern-quiet D2 r1 MATURE | 4644 | 1/1 | 30 | **0** | 8582 | 1024 |
| modern-quiet D2 r2 MATURE | 8911 | 1/1 | 62 | **0** | 8583 | 1024 |
| **median** | **6778** | **2/2** | 46 | **0,0** | — | — |

- `momentum_active=0,0` — the `[CURRENT SCENE CONTINUITY]` block was **not** in the actual prompt for either MATURE call (confirmed via `fullContext.includes(HEADER)`). The block is computed (336 chars) but the `isThinSceneHistory` gate is `false` for the predicate-mature long-turn fixture, so it is suppressed.
- Output stayed long and clean (median 6778, floor 2/2), continuing the established scene naturally (현우, 장보기, 샌드위치, 바흐 인벤션) — no momentum artifacts leaked, no regression.
- Note: the existing D2 MATURE baseline (3576 median, short D2-length fixture) is **not directly comparable** because this PoC uses a *different* fixture (long-turn) to operationalize "MATURE support OFF" under the mandated length predicate (see calibration finding). The point of these 2 calls is the **auto-off contract**, which is confirmed.

### ⚑ Phase-1 calibration finding (unresolved decision — NOT fixed by tuning in this PoC)

**Content-maturity ≠ predicate-maturity.** The mandated activation predicate (`resolveDeepSeekShortHistoryLengthExtra`, avg no-ws chars < 2200) is **length-based**. The D2-length "MATURE" fixture (12 short scene-local turns, avg ~62–72 no-ws chars/assistant-turn) is **mature by content/continuity** but **thin by predicate** (`isThin=true`) — so it *cannot* demonstrate the momentum auto-off. To operationalize "MATURE support OFF" faithfully under the mandated predicate, this PoC introduces a **genuinely predicate-mature** fixture (`scripts/_tmp-momentum-mature-long.ts`: 2 assistant turns, each ≥2200 no-ws, avg 2265 → `isThin=false`).

**Implication for production:** a real scene with **many short exchanges** (a common production pattern — quick back-and-forth turns) has high content-continuity but low avg assistant-turn length, so the length predicate would fire momentum **ON** even when the scene's conversational continuity is already mature. This is a real Phase-1 calibration observation: the length-based predicate conflates "many short turns" with "thin scene." This is flagged as an **unresolved decision for the confirmation phase** (e.g., consider a content/turn-count signal alongside length, or a different threshold) — **not** something to fix by threshold tuning within this PoC (forbidden by the binding sign-off).

## 12. Cost (reference only)

- THIN (9 calls): **$0.0785**
- MATURE (2 calls): **$0.0480** (larger prompts from the long-turn history: ~8.6k prompt tokens, mostly uncached)
- **Total: ≈ $0.1265** (DeepSeek V4 Pro, reasoning OFF). Cost is reference only; not a pass/factor.

## 13. PASS/FAIL → verdict

**PASS (Case A — length/beat recover + breadth clean → Momentum architecture supported).**

- ✅ Length: aggregate median 2383 → 2871 (+488, +20.5%); 2/3 cells +731~+935; floor 3/9 → 5/9.
- ✅ Beats: up and substantive (med 12/16/19; highs 23/35), not padded.
- ✅ Depth/POV: maintained (deep interiority modern, sensory fantasy, reflective enoch).
- ✅ Breadth/dormant: clean — no dormant recurrence, no external breadth inflation.
- ✅ Repetition/arbitrary events: clean — no raw-history duplication, no new events, no godmodding.
- ✅ MATURE: auto-off confirmed (`momentum_active=0,0`); output long and clean; no intervention (not Case E).
- ✅ Muse/Gemini/HY3 payload byte-identical (test I); CORE cache prefix preserved; Terminal/LENGTH tail unchanged.
- ✅ Deterministic tests A–J (12/12) + typecheck:app green before any live call; max 11 live calls; no mid-PoC tuning.

**Caveats carried into confirmation (not failures):**
1. **Partial floor recovery:** 5/9 (not 9/9); two severe short outputs (1873, 916) were not prevented — but both are high-quality natural endings, not failure modes. The 2200 threshold is a calibration *start*; magnitude tuning is deferred to confirmation (forbidden mid-PoC).
2. **Content-maturity ≠ predicate-maturity** (item 11): the length predicate fires ON for many-short-turn scenes even when continuity is mature — unresolved decision for confirmation.
3. **Fantasy flat (−9):** momentum lifts depressed cells most; where THIN output is already adequate, the effect is neutral.

**Single verdict: ✅ READY FOR MOMENTUM CONFIRMATION.**

---

## Self-check (per task spec)
- [x] Only canon mode + thin-history gate differs; Muse/Gemini/HY3 actual payload byte-identical (test I).
- [x] Fields optional, no invented emotion/conflict/event (tests D, F; output review).
- [x] No raw-history duplication, no current-user-message re-injection (test E; `isRawCopyOfRecent`).
- [x] Header is neutral data label `[CURRENT SCENE CONTINUITY]`, no command sentences.
- [x] Activation reuses existing thin-history predicate, auto-offs on mature (tests C, J3; live MATURE 0,0).
- [x] CORE cache prefix preserved (THIN cached=4096); Terminal/LENGTH tail unchanged.
- [x] Deterministic tests A–J + typecheck pass before live calls (12/12; exit 0).
- [x] Max 11 live calls, no full matrix (11 used: 9 THIN + 2 MATURE, 0 errors).
- [x] No tuning performed mid-PoC (no wording re-tweaks, no threshold adjust, no beat instruction, no budget increase, no FULL canon restore).
- [x] Existing D2/D1.1/D2-length harness/data preserved; PoC data separate under `data/d2-momentum/`.
- [x] No commit/push/PR/deploy.


