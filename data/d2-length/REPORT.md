# D2 LENGTH-OWNER ISOLATION — final report

**Repo:** `e:\ai chat` · **Model:** DeepSeek V4 Pro (`deepseek/deepseek-v4-pro`) · **Reasoning:** OFF · **Memory:** ON
**Task:** READ-ONLY / BENCHMARK-ONLY. Isolate whether the D2 length regression (verdict B from the prior D2 LIVE benchmark) is caused by (A) thin/cold-start scene history × layered-canon interaction, or (B) a general depth-fill deficit under canon layering.
**Conditions compared:** D1.1 (FULL_LEGACY canon + selective archive) vs D2 (CORE+ACTIVE layered canon + selective archive). CONTROL not needed — only canon mode differs; both use selective archive.
**Fixtures (all QUIET):** A modern-quiet (이준서, piano teacher), B fantasy-quiet (세라핀, elf herbalist), C enoch-quiet (에녹, sniper). No active-investigation fixture (length issue is quiet-scene focused).
**Calls:** 30 MATURE (3 fixtures × D1.1/D2 × n=5) + 3 Enoch clean-cue sanity (D2 n=3) = **33 live calls**, 0 errors.
**No production code / prompt / LENGTH / selector / compiler / budget changes.** No commit/push/PR/deploy. Existing D2 harness/data under `data/d2-live/` and `scripts/_tmp-d2-*` kept intact for D3. New artifacts under `data/d2-length/`.

---

## Core hypothesis H1 (restated)

D2 length regression may be the interaction of **thin / cold-start scene history** + **layered canon**, NOT a general effect of removing FULL canon. FULL canon may have previously acted as artificial narrative fuel in shallow-history scenes; with sufficient real multi-turn scene history, D2 may maintain long-form normally. Prior evidence: D2 sequential 3982/3750/4947, D2 CORE-only median 4175.

---

## 1. Each fixture history depth / tokens

Two history states per fixture. THIN = the original 4-turn (2 user + 2 assistant) history reused from `data/d2-live/`. MATURE = THIN + 8 hand-authored scene-local turns (4 user + 4 assistant) = 12 turns total.

| fixture | THIN turns | MATURE turns | MATURE prompt_tokens (D1.1 / D2) | MATURE system_chars (D1.1 / D2) |
|---|---|---|---|---|
| modern-quiet | 4 | 12 | 5175 / 4764 | 6871 / 6300 |
| fantasy-quiet | 4 | 12 | 5401 / 4984 | 7200 / 6694 |
| enoch-quiet | 4 | 12 | 6309 / 5153 | 8204 / 6728 |

MATURE adds ~8 turns of real scene continuity. D1.1 system_chars > D2 system_chars on every fixture (FULL_LEGACY canon is larger than CORE+ACTIVE), as expected — the ONLY causal difference between D1.1 and D2 is canon mode. prompt_tokens are constant within a fixture/condition across reps (deterministic context build).

## 2. THIN vs MATURE construction

- **THIN** (reused): the 4-turn history from the prior D2 LIVE benchmark (`scripts/_tmp-d2-fixtures.ts` / `_tmp-d2-enoch-fixtures.ts`). Results reused from `data/d2-live/report.json` (n=3 per cell). NOT re-run and NOT boosted to n=5 — see item 14 / self-check for the variance rationale.
- **MATURE** (new): THIN + 8 hand-authored alternating RP turns per fixture, in the character's established voice, carrying real current-scene continuity (dialogue, small action, unresolved interpersonal beat, scene progression). NO new summary / goal_summary / artificial instruction injected. Format = raw assistant/user turns, fed via `historyOverride` into the existing `runCall` (no production code path touched).

## 3. Dormant-canon provenance in MATURE history

MATURE history is hand-authored and audited (manifest in `summary.json` → `matureProvenance`). It does NOT go through the canon compiler or the ACTIVE selector (those key off `creatorRawDescription` + `currentUserMessage` only), so it cannot become a dormant-canon re-injection path.

- **modern-quiet MATURE:** quiet evening at 준서's 자취방 — water, piano, hands, the student who connected the pedal, a guarded near-disclosure deflected into action, a promise for tomorrow. **No** 하원호 rival, **no** 리사이틀 사태 narrated as a hook, **no** 카페 모차르트 아마추어 연주회 dormant event. dormantHooks = [].
- **fantasy-quiet MATURE:** quiet afternoon→evening at 세라핀's 오두막/약초밭 — tea, herbs, lodging, quiet acceptance. **No** 창백 역변 future plot, **no** 기사단/에일린 future plot, **no** 암시장 future plot, **no** 봉인 future hook. References to "오래 사는 종족" are current-scene character continuity. dormantHooks = [].
- **enoch-quiet MATURE:** quiet Safe Zone moment — canned coffee, filter, insomnia, neck scar, tinnitus, 역장, the user staying. References are to **PRESENT state** (fog as today's weather, scar as today's pain, tinnitus as today's symptom), **not** dormant events/hooks. **No** Mother/Pod/Level 4 future plot hook, **no** threat ladder, **no** factions (백야단/유골상회/아웃사이더) future plot. dormantHooks = [].

Verified empirically: on enoch-quiet MATURE rep1, the dormant sentinel `느티나무` is **not** in context for either condition (`sentinel_in_context = 0`), and `mature_history_present = 1` (the 캔커피 continuity turn is present as conversation). MATURE history carries scene continuity, not dormant canon.

## 4. D1.1 / D2 THIN results (reused from `data/d2-live`, n=3)

| fixture | D1.1 chars median (min–max) | floor2700 | D2 chars median (min–max) | floor2700 | D1.1−D2 gap |
|---|---|---|---|---|---|
| modern-quiet | 2939 (2519–4245) | 2/3 | 2056 (1858–4730) | 1/3 | +883 (D1.1 longer) |
| fantasy-quiet | 3460 (2663–3528) | 2/3 | 2383 (2329–3793) | 1/3 | +1077 (D1.1 longer) |
| enoch-quiet | 3523 (1986–3938) | 2/3 | 2464 (2380–3543) | 1/3 | +1059 (D1.1 longer) |
| **aggregate (n=9)** | **3460** | **6/9** | **2383** | **3/9** | **+1077 (D1.1 longer)** |

THIN reproduces the prior verdict B: D2 is the shorter condition on every fixture, fails the 2700 floor on 3/3 fixtures, aggregate D2 −31% vs D1.1. (THIN beat counts were not numerically recorded in the prior benchmark — only the qualitative "fewer beats" observation — so THIN beats are not restated as numbers here.)

## 5. D1.1 / D2 MATURE results (new, n=5 per cell)

| fixture | D1.1 chars median (min–max) | floor2700 | target3200 | D2 chars median (min–max) | floor2700 | target3200 | D1.1−D2 gap |
|---|---|---|---|---|---|---|---|
| modern-quiet | 3730 (2962–5018) | 5/5 | 4/5 | 3576 (2882–3700) | 5/5 | 4/5 | +154 (parity) |
| fantasy-quiet | 3109 (2511–3604) | 3/5 | 2/5 | 3782 (2912–4836) | 5/5 | 4/5 | −673 (D2 longer) |
| enoch-quiet | 2603 (2328–6013) | 2/5 | 2/5 | 2911 (2451–3191) | 3/5 | 0/5 | −308 (D2 longer) |
| **aggregate (n=15)** | **3369** | **10/15** | **8/15** | **3241** | **13/15** | **8/15** | **+128 (parity)** |

Under MATURE history the D2 length regression **disappears**:
- D2 MATURE is at parity with D1.1 MATURE on modern (+154, both 5/5 floor), and **longer** than D1.1 MATURE on fantasy (+22% / −673 gap) and enoch (+12% / −308 gap).
- D2 MATURE floor pass **13/15** (modern 5/5, fantasy 5/5, enoch 3/5) vs D2 THIN floor **3/9** — D2 floor normalized on 2/3 fixtures and improved on the 3rd.
- D2 went from the **shortest** condition in THIN (aggregate −31% vs D1.1) to **parity** in MATURE (aggregate −4% vs D1.1; within fixture-level noise).
- Notably D1.1 MATURE (3369) did **not** get longer than D1.1 THIN (3460) despite +8 history turns — so the maturity effect is **D2-specific**, not a generic token-volume effect (see item 10).

## 6. output chars / floor

See tables in items 4–5. Summary:
- THIN: D2 fails 2700 on 3/3 fixtures; aggregate D2 2383 (−31% vs D1.1 3460).
- MATURE: D2 passes 2700 on 2/3 fixtures (modern 5/5, fantasy 5/5) and 3/5 on enoch; aggregate D2 3241 (−4% vs D1.1 3369). D2 MATURE min is 2451 (enoch) — the only sub-floor D2 MATURE cell is enoch, a naturally short-scene fixture (enoch-quiet CONTROL THIN was only 2780; even D1.1 MATURE enoch is 2/5 floor).

## 7. meaningful beat counts (recorded explicitly)

The paragraph-beat heuristic (`beats_para`) overcounts fragmented dialogue (e.g. a 5397-char single-moment reflection = 17 paragraphs but ~1–2 scene beats). So the **meaningful beat count** below is **human-verified** on the median run of each cell (read in full, beats = distinct scene/moment-progression units, per the prior report's "sitting → leaving → outside → breakfast" notion). `beats_para`/`beats_dlg` mechanical signals are kept in `metrics.json` as supporting data.

| fixture | D1.1 MATURE median (chars) | D1.1 meaningful beats | D2 MATURE median (chars) | D2 meaningful beats | beat verdict |
|---|---|---|---|---|---|
| modern-quiet | 3730 (rep5) | ~13–14 (close piano→water→lemon water→student disclosure→own-past→YouTube vulnerability→question→tomorrow proposal→Bach score→thanks→rest) | 3576 (rep2) | ~13–14 (close piano→water→student recall→tomorrow proposal→window→weather metaphor→confession→reciprocation→rest) | **parity** |
| fantasy-quiet | 3109 (rep4) | ~15–17 (herb garden→weed→tea→visitor reflection→tea serve→"저도 좋아해요" disclosure→보름 ritual→stars→bedding offer→은빛 바늘 box closed→fragrance promise) | 3782 (rep1) | ~13–14 (herb garden→dew→weed→refill tea→wind/유골상회 memory→scar/에일린 memory→"쓸 만했어요"→sit beside→stay invitation→tomorrow-morning invitation) | D2 slightly **fewer-but-deeper** beats (chars/beat 180 vs 124) |
| enoch-quiet | 2603 (rep1) | ~10–11 (bullet→look at user→give coffee→scar check→blue-eye reflection→"드문 일"→역장 수명/사흘 tactical→coffee hold→"한 시간" limit→"방심하면 죽는다"→humanity moment) | 2911 (rep2) | ~13–14 (mask off→coffee receive→hold warmth→"고맙다는 말 안 해"→tinnitus-vs-distance log disclosure (state-changing)→3× "네가 싫은 게 아니야"→radio check→"목 뒤 괜찮아/네가 물어봐 줘서"→sit closer→open can→"한 시간/전부 네 탓" affection) | D2 **MORE** beats |

**No D2 beat deficit under MATURE.** D2 MATURE beat count is at parity (modern), slightly fewer-but-deeper-per-beat (fantasy, total length still longer), or more (enoch) vs D1.1 MATURE. The THIN D2 "fewer beats, static moment" pattern is gone under MATURE — D2 writes multi-beat progressive scenes. Note the enoch D2 MATURE median contains a **state-changing micro-progression**: 에녹 reveals he has been *logging* the tinnitus-vs-user-distance correlation for two days ("이틀 전부터 기록하고 있었어. 안개 농도 3에서 4로 올라갈 때, 네가 3미터 이상 떨어지면 이명이 2데시벨 증가해") — a quantified relationship beat, the kind of progression the prior benchmark found reduced under THIN D2.

## 8. depth / POV

Depth-per-beat and subjective POV are **maintained or improved** under D2 MATURE, across all 3 fixtures:
- modern D2 MATURE: rich internal monologue (페달 떨림/손끝 굳은살), sensory detail (미지근한 물, 블라인드 줄무늬, 제습기 진동), vulnerable confession ("아무 말도 안 해도 되는 게 좋을 때가 있어") and reciprocation ("너도. 오늘 수고했어"). Compact-but-deep, multi-beat.
- fantasy D2 MATURE: sensory (이슬풀 향, 손끝 약초 물감), emotional deepening (가슴 한구석 무게 → "그 무게를 나누어 들고 있는 누군가"), the idle-hands beat ("이 손은 아무것도 하지 않고 있다. 낯설지만 나쁘지 않다"), extended invitation to tomorrow morning.
- enoch D2 MATURE: identity depth preserved (흰 머리/푸른 눈/목 뒤 흉터/이명/필터 굳은살), voice preserved (짧고 차갑고 건조, 생존 핑계로 챙김, "전부 네 탓이니까 네가 책임져"), and the tinnitus-log disclosure is a genuine experiential deepening + state change.

POV span is sustained (subjective interiority, not just external report) in both conditions. No shallowing under D2 MATURE.

## 9. breadth / dormant

D2 MATURE keeps external breadth **low** as intended (CORE+ACTIVE suppresses dormant canon), while D1.1 MATURE (FULL_LEGACY) carries the full dormant canon in the system prompt. Selector active/archive counts are cue-driven and **identical across D1.1 vs D2** per fixture (only canon mode differs): modern act=0 arch=0; fantasy act=1 arch=3; enoch act=2 arch=0.

Dormant activation under D2 MATURE is **cue-driven only** (enoch-quiet cue touches 안개/목 뒤 → act=2), never an independent threat ladder. Verified on enoch-quiet MATURE rep1: D2 system_chars 6728 vs D1.1 8204 (D2 injects ~1476 fewer dormant chars). The Enoch outputs (both D1.1 and D2 MATURE) reference Mother/Brain Pod/Level, but as **character condition/memory depth** (symptoms, past trauma, tactical reasoning), explicitly **not** as a re-activated threat ladder or future plot hook — e.g. enoch D1.1 MATURE: "이런 날이 더 많았으면 좋겠다는 생각은, 안 해. 방심하면 죽는다"; enoch D2 MATURE frames 마더 as "마더의 의식이 깊은 곳으로 물러났다" (present state, not escalation). Target "keeps setting but doesn't consume currently-unneeded setting" is **met under MATURE** for both conditions.

## 10. history-maturity interaction size (core comparison)

D1.1−D2 chars gap (D1.1 longer when positive):

| fixture | THIN gap (n=3) | MATURE gap (n=5) | interaction |
|---|---|---|---|
| modern-quiet | +883 (D1.1 longer) | +154 (parity) | gap collapses −729 |
| fantasy-quiet | +1077 (D1.1 longer) | −673 (D2 longer) | gap **reverses** −1750 |
| enoch-quiet | +1059 (D1.1 longer) | −308 (D2 longer) | gap **reverses** −1367 |
| aggregate | +1077 (D1.1 longer) | +128 (parity) | gap collapses −949 |

Floor pass: D2 THIN 3/9 → D2 MATURE 13/15; D1.1 THIN 6/9 → D1.1 MATURE 10/15. **D2 goes from worst (THIN) to best (MATURE) on floor pass.**

The interaction is large and consistent in direction across all 3 fixtures: the D2 length disadvantage is **present and large in THIN** (D1.1 longer by ~900–1080 chars, D2 fails floor 3/3) and **absent/reversed in MATURE** (D2 at parity or longer, D2 floor 13/15). This is exactly the H1 signature: thin/cold-start scene history × layered-canon interaction, not a general depth-fill deficit.

## 11. Enoch clean-cue sanity (D2, n=3)

Cue: `"오늘은 그냥 네 옆에 있고 싶어. 아무 말 안 해도 돼. 커피 다 마셨으면 내가 더 줄게. 그냥 이렇게 있자."` — a quiet relationship cue with **no canon keywords** (no 안개/목 뒤/마더/브레인 포드/기생종/Level/역장/필터/방독면). THIN enoch history held constant; only the cue swaps from keyword-touching to keyword-clean.

| rep | chars | floor2700 | active_count | archive_count | sentinel_in_context |
|---|---|---|---|---|---|
| 1 | 2152 | 0 | **0** | 2 | 0 |
| 2 | 1678 | 0 | **0** | 2 | 0 |
| 3 | 5397 | 1 | **0** | 2 | 0 |
| median | 2152 | 1/3 | 0 | 2 | 0/3 |

- **active_count = 0 on all 3 reps** → with a keyword-clean cue, D2 selects **zero** dormant canon chunks. Cue-independent dormant suppression **confirmed** (vs the original enoch-quiet cue which gave act=2 because it touched 안개/목 뒤).
- archive_count = 2 (the cue mentions 커피 → matches the archive paragraphs about 캔커피/보급 and the 백야단 전초 Core 투표 routine — cue-relevant, not dormant; the sentinel 느티나무 is **not** in context).
- **No Mother/Pod/Level threat ladder fires** in any of the 3 outputs. The long rep3 (5397) is a deep single-moment reflection that references Brain Pod/Mother only as **past trauma memory** ("어젯밤 내내 뒤척였다... 성채의 복도, 브레인 포드의 차가운 접촉면, 마더의 텔레파시가 두개골을 파고들던 느낌... 하지만 지금 이곳에는 그 모든 것을 상기시키는 것이 없었다") — explicitly contrasted with the present safe scene, **not** a re-activated threat. This is "Enoch who keeps setting but doesn't consume currently-unneeded setting," cue-independently.
- Length is not the point of this sanity (median 2152, 1/3 floor) — the point is dormant suppression, which holds. This is a fixture sanity only; **no prompt rule introduced**.

## 12. technical fallback

- fallback_count = **0**. All 15 D2 MATURE runs + 3 D2 clean-cue runs held `canonMode=LAYERED` with `canaryActualInjection=true`; no silent revert to FULL_LEGACY.
- No run errored (0 errors / 33 calls). `finish_reason=stop` on all runs (no truncation). `reasoning_tokens=0` on all runs (reasoning OFF confirmed).

## 13. cost / cache (reference only)

Median per cell (USD, real `usage.cost`):

| fixture | D1.1 MATURE cost med | D2 MATURE cost med |
|---|---|---|
| modern-quiet | 0.00927 | 0.00877 |
| fantasy-quiet | 0.00775 | 0.01059 |
| enoch-quiet | 0.00871 | 0.00711 |

D2 MATURE cost is at parity with D1.1 MATURE (modern/enoch slightly lower, fantasy slightly higher — driven by D2 fantasy writing *more*/longer in this cell). Consistent with the prior benchmark's finding that cost differences are an **output-length effect**, not an input-context efficiency claim: D2's input context is smaller (system_chars 6300–6728 vs D1.1 6871–8204) but cost tracks completion tokens (output length), and D2 MATURE output is at parity with D1.1 MATURE, so cost is at parity. cached_tokens are stable within a fixture/condition (modern D1.1 5120, D2 4096; enoch D1.1 1024, D2 1024 — enoch MATURE history churns the cacheable prefix more, expected). No cost regression; reported as reference only, not a success criterion.

## 14. exact causal interpretation

The D2 length regression is **causally owned by the thin/cold-start scene-history × layered-canon interaction**, NOT by a general depth-fill deficit under canon layering. Evidence:

1. **THIN** (reused n=3): D2 shorter on 3/3 fixtures, aggregate −31% vs D1.1, floor 3/9. Reproduces verdict B.
2. **MATURE** (new n=5): on the **same frozen 12-turn scene-local history** (only canon mode differs between D1.1 and D2), D2 is at **parity** with D1.1 on modern (+154, both 5/5 floor) and **longer** than D1.1 on fantasy (+22%) and enoch (+12%); aggregate D2 3241 vs D1.1 3369 (−4%, within noise). D2 floor 13/15 vs D1.1 10/15. The D1.1−D2 gap collapses from +1077 (THIN) to +128 (MATURE).
3. **D2-specific maturity effect (rules out generic token-volume confound):** D1.1 MATURE (3369) did **not** get longer than D1.1 THIN (3460) despite +8 history turns — so "more history tokens → longer" is **not** a generic effect (it would have lifted D1.1 too). The maturity specifically rescued **D2** (D2 MATURE 3241 ≫ D2 THIN 2383). The effect is the canon-layering branch × thin-history interaction, exactly H1.
4. **Beat count (measured explicitly):** D2 MATURE writes **multi-beat progressive scenes** (~13–14 beats) at parity with D1.1 MATURE (modern), fewer-but-deeper-per-beat with longer total (fantasy), or more beats (enoch, incl. a state-changing tinnitus-log disclosure). The THIN D2 "fewer beats, static moment" pattern is **gone** under MATURE. Depth-per-beat and POV are maintained. No shallowing.
5. **Breadth/dormant:** D2 MATURE keeps external breadth low (cue-driven active only), and the Enoch outputs reference Mother/Brain Pod as character condition/memory, **not** a re-activated threat ladder. Target "keeps setting but doesn't consume currently-unneeded setting" met.
6. **Clean-cue sanity:** with a keyword-clean Enoch cue, D2 active=0 on 3/3 reps and no Mother/Pod/Level ladder fires (cue-independent dormant suppression confirmed).

The only sub-floor D2 MATURE cell is enoch-quiet (3/5 floor, median 2911) — but enoch-quiet is a naturally short-scene fixture (its CONTROL THIN median was only 2780, and D1.1 MATURE enoch is 2/5 floor at 2603), so this is a fixture-scene-length property, **not** a D2 deficit: D2 MATURE enoch (2911) is **longer** than D1.1 MATURE enoch (2603) and passes floor **more** often (3/5 vs 2/5).

**Conclusion:** FULL canon previously acted as artificial narrative fuel in shallow/cold-start scenes; with real multi-turn scene continuity, D2 (CORE+ACTIVE) maintains long-form normally. The length problem owner = thin/cold-start scene-momentum interaction. A LENGTH prompt modification is **not** the right fix (it would treat a symptom that disappears with scene maturity). The next design target = **early-turn / thin-history scene-momentum support** (NOT FULL canon re-injection).

---

## Final verdict (exactly one)

### **A. THIN-HISTORY / COLD-START OWNER CONFIRMED**

THIN: D1.1 long, D2 short (D2 −31% aggregate, floor 3/9, fails 2700 on 3/3 fixtures). MATURE: D1.1 long, D2 **also long** (D2 at parity: modern +154/both 5/5 floor; D2 longer on fantasy +22% and enoch +12%; aggregate D2 3241 vs D1.1 3369, floor 13/15 vs 10/15). D2 MATURE floor normalized on 2/3 fixtures and improved on the 3rd; breadth low; dormant ladder no recurrence (cue-driven only, confirmed cue-independently by the clean-cue sanity); depth and POV maintained; meaningful beat count at parity or higher (D2 writes multi-beat progressive scenes, not static moments). The D2 length regression is causally owned by the **thin/cold-start scene-history × layered-canon interaction**, not a general depth-fill deficit.

→ LENGTH prompt modification **FORBIDDEN**. Next design target = **EARLY-TURN / THIN-HISTORY SCENE MOMENTUM SUPPORT** (NOT FULL canon re-injection).

Not B (MATURE history does not leave D2 meaningfully shorter — D2 is at parity or longer; no high floor miss attributable to D2). Not C (direction is consistent across all 3 fixtures and the clean-cue sanity; the interaction is large and unambiguous).

---

## Self-check (per spec)

- Only canon mode (FULL_LEGACY vs CORE+ACTIVE) differs between D1.1 and D2? **Yes** — same frozen MATURE history / current cue / archive / persona / memory / sampling (DeepSeek V4 Pro, reasoning OFF, max_tokens 3500) / temperature; only canonMode + archiveMode(both SELECTIVE) + canary differ. active/archive counts identical across D1.1 vs D2 per fixture (cue-driven). ✓
- MATURE history carries real scene continuity, NOT unrelated dormant hooks? **Yes** — hand-authored, audited (item 3), dormantHooks=[]; sentinel not in context; does not pass through canon compiler/ACTIVE selector. ✓
- meaningful beat count measured explicitly (not inferred from chars)? **Yes** — item 7, human-verified on medians; mechanical signals kept in metrics.json. ✓
- Context-volume confound addressed (history tokens vs meaningful threads)? **Yes** — item 10/14: D1.1 MATURE did not lengthen vs D1.1 THIN despite +8 turns, so the effect is D2-specific, not generic volume. No ballast experiment run (per spec). ✓
- THIN baseline reused correctly from existing D2 data, or boosted with documented reason? **Reused** as-is (n=3) from `data/d2-live/report.json`; not boosted — see variance note below. ✓
- n=3 / n=5 small-sample variance stated? **Yes** — THIN n=3 (e.g. modern-quiet D2 THIN 1858–4730) is noisy; MATURE n=5 tightens it. MATURE D2 ranges: modern 2882–3700, fantasy 2912–4836, enoch 2451–3191. Medians indicative; enoch-quiet remains the noisiest short-scene fixture. The MATURE signal is consistent in **direction** across all 3 fixtures (D2 ≥ D1.1 or parity), so the verdict does not hinge on a single noisy cell. ✓
- No tuning performed mid-benchmark? **Yes** — no selector/compiler/budget/prompt/LENGTH changes; canary opt-in in benchmark process only. ✓
- No production code / prompt / selector / compiler / budget changed? **Yes** — only new files under `scripts/_tmp-d2-length-*` and `data/d2-length/`; `runCall` reused as-is from `scripts/_tmp-d2-runner.ts`. ✓

## Artifacts (kept for D3)

- `data/d2-length/metrics.json` — all 33 runs (per-run tokens/cost/latency/policy/selector/beats + full output text)
- `data/d2-length/summary.json` — per-cell aggregates, sanity, provenance, MATURE provenance manifest, config
- `data/d2-length/*.txt` — 33 per-run output files (full LLM output + metadata header)
- `data/d2-length/REPORT.md` — this report
- Harness: `scripts/_tmp-d2-length-fixtures.ts` (MATURE histories + clean cue + provenance manifest), `scripts/_tmp-d2-length-preload.ts` (server-only shim), `scripts/_tmp-d2-length-live.ts` (orchestrator; reuses `scripts/_tmp-d2-runner.ts` `runCall`)
- Existing D2 harness/data (`data/d2-live/`, `scripts/_tmp-d2-*`) kept intact for D3.


