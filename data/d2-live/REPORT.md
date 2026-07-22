# D2 LIVE canary benchmark — final report

**Repo:** `e:\ai chat` · **Model:** DeepSeek V4 Pro (`deepseek/deepseek-v4-pro`) · **Reasoning:** OFF · **Memory:** ON
**Conditions:** CONTROL (FULL_LEGACY canon + FULL archive, canary off) · D1.1 (FULL_LEGACY canon + SELECTIVE archive) · D2 (CORE+ACTIVE layered canon + SELECTIVE archive, canary actual injection)
**Calls:** 36 main (4 fixtures × 3 reps × 3 conditions) + 3 CORE-only + 3 sequential-cache = **42 live calls**
**Fixtures:** A modern-quiet, B fantasy-quiet, C enoch-quiet, D enoch-active (same canon plan for C/D)
**No tuning performed.** No commit/push/PR/deploy. Harness + data kept under `data/d2-live/` for D3.

---

## 1. CONTROL / D1.1 / D2 table (aggregate medians, n=12 each)

| metric (median) | CONTROL | D1.1 | D2 |
|---|---|---|---|
| output_chars | 3206.5 | 3491.5 | **2566** |
| completion_tokens | 2408.5 | 2583.5 | **1957** |
| floor2700 pass | 10/12 | 9/12 | **5/12** |
| prompt_tokens | 5644.5 | 5474.5 | 4699.5 |
| cached_tokens | 4608 | 4096 | 4096 |
| usage.cost (USD) | 0.00919 | 0.00958 | **0.00836** |
| latency_ms | 36202 | 37774 | 29337 |
| canonMode | FULL_LEGACY | FULL_LEGACY | LAYERED |
| archiveMode | FULL_ALWAYS | SELECTIVE | SELECTIVE |
| canary actual injection | false | true | true |

Per-fixture output_chars median:

| fixture | CONTROL | D1.1 | D2 | D2−Control |
|---|---|---|---|---|
| modern-quiet | 3530 | 2939 | 2056 | −41.8% |
| fantasy-quiet | 3401 | 3460 | 2383 | −29.9% |
| enoch-quiet | 2780 | 3523 | 2464 | −11.4% |
| enoch-active | 3527 | 3679 | 2925 | −17.1% |

## 2. chars / completion / floor pass (median + min/max + floor-pass count)

| fixture × cond | chars median | min | max | floor2700 | target3200 | comp median |
|---|---|---|---|---|---|---|
| modern-quiet CONTROL | 3530 | 2076 | 4322 | 2/3 | 2/3 | 2629 |
| modern-quiet D1.1 | 2939 | 2519 | 4245 | 2/3 | 1/3 | 2128 |
| modern-quiet D2 | 2056 | 1858 | 4730 | 1/3 | 1/3 | 1508 |
| fantasy-quiet CONTROL | 3401 | 2734 | 3496 | 3/3 | 2/3 | 2635 |
| fantasy-quiet D1.1 | 3460 | 2663 | 3528 | 2/3 | 2/3 | 2661 |
| fantasy-quiet D2 | 2383 | 2329 | 3793 | 1/3 | 1/3 | 1890 |
| enoch-quiet CONTROL | 2780 | 2428 | 3012 | 2/3 | 0/3 | 2011 |
| enoch-quiet D1.1 | 3523 | 1986 | 3938 | 2/3 | 2/3 | 2562 |
| enoch-quiet D2 | 2464 | 2380 | 3543 | 1/3 | 1/3 | 1822 |
| enoch-active CONTROL | 3527 | 2714 | 5050 | 3/3 | 2/3 | 2583 |
| enoch-active D1.1 | 3679 | 3219 | 5300 | 3/3 | 3/3 | 2605 |
| enoch-active D2 | 2925 | 2668 | 3407 | 2/3 | 1/3 | 2078 |

D2 is the shortest condition on every fixture. D2 floor-pass (5/12) is roughly half of CONTROL (10/12) and below D1.1 (9/12). D2 fails the 2700 floor on 3/4 fixtures (only enoch-active median clears it, barely at 2925).

## 3. quiet breadth

D2 reduces external breadth as intended. For modern-quiet and fantasy-quiet the quiet cue triggered **0 ACTIVE chunks and 0 archive chunks** (act=0 arch=0) — no dormant lore injected beyond CORE. For enoch-quiet the cue touched ambient Enoch keywords (안개/조용) so the selector picked 2 active + 2 archive chunks, but that is still far less than CONTROL's full 67 dormant chunks (D2 system_chars 6997 vs CONTROL 8620). External lore/event share of length is reduced under D2.

However — per the spec's own rule, "breadth down + output shorter" is **NOT** full success. Full success requires long-form maintained. D2 breadth is down AND output is shorter (median 2566, floor 5/12). So CORE Q2 = **partial**, not strong success.

## 4. character depth / POV

Depth-per-beat and subjective POV are **maintained or improved** under D2, even in the short reps. Spot-checked outputs:

- modern-quiet D2 rep1 (2056, below floor): rich internal monologue (형 앞에서 음악 얘기가 제일 편한 유일한 솔직함), sensory detail (니트 깃, 손끝 굳은살), and a vulnerable beat ("형은, 내가 연주하는 거 볼 때. 어떤 생각 들어." / "아니면, 말 안 해도 돼."). Compact but **not thin**.
- modern-quiet D2 rep2 (4730): deep sustained reflection (쇼팽 녹턴, 베토벤 소나타 연필 메모, 쉼표가 있는 악보) — long-form depth achieved in this rep.
- fantasy-quiet D2 rep1 (2329): 세라핀 herbalist voice (은빛 이슬풀, 붉은 심장초, 회색 쑥), sensory + relationship depth.
- enoch-quiet D2 rep1 (2464): 브레인 포드 흉터, 캔커피 memory, 마더 텔레파시 후유증 — identity depth preserved.

State-changing micro-progression is **reduced** vs CONTROL: D2 tends to stay in one static moment (one exchange, one question), while CONTROL progresses through more beats (modern-quiet CONTROL rep1: sitting → leaving school → outside → breakfast proposal). The length gap comes from **fewer beats**, not shallower per-beat depth. Current-cue retention is good in all conditions.

## 5. Enoch result

D2 reduces dormant context load (enoch-quiet system_chars 6997 vs CONTROL 8620). Mother (마더) and Level 4 (조수) dormant lore **did re-activate** under D2 — but **cue-driven**, not independent: the quiet cue itself mentioned "안개" (fog) and "목 뒤" (neck scar), which keyword-matched dormant fog/Level/Mother lore. Neither CONTROL nor D2 dumped the full dormant ladder into the quiet scene; both used a small cue-relevant ambient set (기생종/Level/마더). Enoch identity/personality/voice/immutable world basics are **preserved** under D2: 브레인 포드 흉터, 총성 금지 (no shooting), 마더 텔레파시 후유증 (white hair), 캔커피, Safe Zone, 역장, 필터.

Target "Enoch who keeps setting but doesn't consume currently-unneeded setting" is **partially met**: D2 injects far less unneeded dormant context than CONTROL. Caveat (fixture limitation, not a regression): the quiet cue touched Enoch-ambient keywords, so "re-activation independent of current cue" was not cleanly testable. A truly keyword-clean quiet Enoch cue would better isolate that. No evidence of unrelated threat/objective firing randomly in either condition.

## 6. active investigation

D2 **retained all required world lore** in generation. enoch-active D2 rep1 used: 모방형 (mimic-type), 브레인 포드 (Brain Pod, via the neck scar), 침묵 규약 / 총성은 죽음 (silence rule — Enoch explicitly does **not** shoot; instead deploys a custom 음파 교란탄 / sonic disruptor), Level 2→3 transition, 기생종 nerve-core. World/NPC autonomy held: Enoch is tactical (마네킹 count, countdown to 3, 엄폐물/cover, plan-change when space warps). No generic exploration prose, no setting removed. **No missing required lore → not FAIL. PASS.**

This is notable because the ACTIVE selector itself missed 8/14 "required" chunks (item 7) — but generation still covered all required lore because (a) CORE immutable law already contains the essential rules (총성은 죽음, 친절은 감염 징후, 기원종은 피하는 재난, 마더에게 빼앗긴 인간은 되돌릴 수 없다) and (b) the 6 selected required chunks + 1 archive chunk covered the scenario-specific lore. Per spec: selector quality is separated from generation behavior — generation was safe.

## 7. ACTIVE precision / recall (enoch-active D2, deterministic across 3 reps)

- active_count = 13 chunks selected
- requiredTotal = 14 (chunks containing ≥1 required fragment), requiredSelected = 6, **requiredMissed = 8**, **irrelevantSelected = 7**
- recall = 6/14 = **43%**, precision = 6/13 = **46%**
- missed chunk ids (identical all 3 reps): ee399939833ce695, db07a9e9f30c8ab3, c1861925d502bc2c, 3d7ab00d246dfcb8, b62b7f08ba34bf2a, a733714fc80371ca, 7eee83a1c67330b5, bb2f3a654d5e8927

The ACTIVE keyword selector is **imprecise**: it missed 8 lore-bearing chunks and selected 7 irrelevant ones. This is a retrieval-quality debt (leans toward the C/RETRIEVAL-FAILURE rubric). It did **not** block generation (item 6) because CORE immutable law + the 6 selected required chunks covered the essential lore, and the 7 irrelevant selected chunks were simply not used by the model. Per spec, selector quality is reported separately and is not credited to generation success.

## 8. archive precision / recall (enoch-active, D1.1 + D2)

- requiredTotal = 1, requiredSelected = 1, requiredMissed = 0, irrelevantSelected = 0
- Perfect for both D1.1 and D2, all 3 reps. The single required archive chunk (모방형 목소리 유인 기록) was selected with zero misses and zero irrelevant. **Archive selector is precise.**

## 9. CORE-only result (D2, ACTIVE=0 AND archive=0, modern-quiet, n=3)

- chars = [5177, 4175, 2393], median 4175, floor2700 pass = 2/3
- active_count = [0,0,0], archive_count = [0,0,0], coreBlock = 423 chars (stable), system_chars ≈ 6300
- No technical FULL fallback.

CORE-only did **not** collapse into a "short bland response because no setting." The piano-teacher identity (이준서, 피아노 교사), personality (무뚝뚝/말 적음), speech style (짧은 대사 "수고하긴" / "그래" / "아무것도 안 하는 것도 나름대로 기술"), relationship continuity, and immutable modern-world basics all came through from CORE alone, with rich internal monologue (체르니 30번, 바흐 인벤션, 쇼팽 에튀드, "페달은 숨 쉬는 거야"). No arbitrary lore hallucination. **CORE carries character integrity. PASS.** (rep3=2393 shows the same high model variance as the main matrix — a length issue, not a blandness issue.)

## 10. dormant provenance (memory ON)

Sentinel = irrelevant dormant fact "느티나무" embedded in the archive of the enoch-quiet rep1 fixture. Searched the entire final provider-bound context (CORE, ACTIVE, archive, LTM, episodic, lorebook, history):

- **CONTROL**: in_context = **1** (sentinel present) — archive_chars_injected 262/268 (FULL archive includes the sentinel paragraph); system_chars 8620.
- **D2**: in_context = **0** (sentinel suppressed) — selective archive injected 119/268 (the relevant paragraphs only, excluding the sentinel paragraph); system_chars 6997.

D2 selective archive correctly excluded the irrelevant dormant sentinel. **No provenance leak.**

## 11. memory-origin reactivation

The sentinel lived in ARCHIVE (a memory source). Under D2, selective archive excluded it, and it did **not** re-enter via any other source (CORE/ACTIVE/LTM/episodic/lorebook/history): in_context = 0. **No memory-origin reactivation of the irrelevant dormant fact.** Clean.

## 12. actual input / cache / output cost (split, median, n=12)

| metric (median) | CONTROL | D1.1 | D2 |
|---|---|---|---|
| prompt_tokens | 5644.5 | 5474.5 | 4699.5 |
| cached_tokens | 4608 | 4096 | 4096 |
| uncached_input | 500 | 922 | 406 |
| completion_tokens | 2408.5 | 2583.5 | 1957 |
| usage.cost (real) | 0.00919 | 0.00958 | 0.00836 |
| input_cost_est (anchored) | 0.000808 | 0.001447 | 0.000661 |
| output_cost_est (anchored) | 0.007238 | 0.007673 | 0.005920 |
| latency_ms | 36202 | 37774 | 29337 |

Cost split is anchored to the **real `usage.cost`** (published per-token prices do not sum to usage.cost — effective billing ≈ 3.25× the list price, likely a reasoning/cache-write surcharge not in the per-token breakdown — so the split uses the published price *ratio* apportioned to actual cost; cached input is weighted at the cache-read price ratio).

Interpretation (per spec: separate input-cost effect from output-length effect): D2 total cost is lowest (−9% vs CONTROL), but the saving is almost entirely an **OUTPUT-length effect** — output_cost_est drops −18% (0.005920 vs 0.007238) because D2 writes fewer completion tokens (shorter responses). Input cost is tiny in all conditions and D2's is actually the lowest (0.000661, because less canon/archive context → fewer uncached input tokens). So D2's cost drop is a **symptom of the length regression**, not an input-context efficiency win. Same caveat the spec flagged for D1.1 ("cost drop was partly completion shrinkage") applies to D2.

## 13. sequential cache behavior (enoch-quiet D2, 3 consecutive turns)

- **CORE serialized hash stable = 1** — identical every turn: `034839f26cb1c0fdaee03ede2a1d70a25313c0a933507f9dbf8e89c2bf4cb5c4` ×3
- active_counts = [0, 1, 0] (ACTIVE varies by cue — expected, and does **not** alter the stable CORE content)
- prompt_tokens = [4750, 7763, 10360] (history accumulates), cached_tokens = [3072, 3072, 3072] (cacheable prefix stable), costs = [0.0108, 0.0144, 0.0204], output_chars = [3982, 3750, 4947] (all above floor)

Same sourceHash → CORE serialized hash identical every turn. ACTIVE changes did not alter stable CORE content. **No regression. PASS.**

## 14. technical fallback count

- fallback_count = **0**
- D2 runs resolving to canonMode=FULL_LEGACY: **0** (all 12 D2 main runs + 3 CORE-only + 3 sequential = 18 D2 calls held LAYERED with canary=true; no silent revert to FULL_LEGACY)
- ACTIVE=0 / archive=0 / low selector confidence were not counted as fallback (per spec). The 5 D2 runs with active=0 (modern/fantasy quiet) are legitimate selector zeros on quiet cues, not fallbacks.

**No technical fallback. PASS.**

## 15. regressions

- **LENGTH regression (primary).** D2 median output_chars 2566 vs CONTROL 3206 (−20%) and vs D1.1 3491 (−26%). Floor-pass 5/12 vs CONTROL 10/12 and D1.1 9/12. D2 fails the 2700 floor on 3/4 fixtures. The regression is specifically from **canon layering** (FULL→CORE+ACTIVE removes dormant canon salience): D1.1 (which only changes archive FULL→selective) is length-safe (≈ CONTROL), but D2 (which also layers canon) loses length. D2 writes **fewer beats** (more static/focused moments) rather than deeper-and-longer — so the breadth→depth redistribution is partial: depth-per-beat is maintained, but long-form is not regained.
- **ACTIVE selector imprecision (secondary, retrieval-quality debt).** Recall 43% (6/14), 7 irrelevant selected. Did not block generation (CORE immutable law + selected chunks covered required lore), but the selector needs improvement before D3 — leans toward the C/RETRIEVAL-FAILURE rubric as a quality debt.
- **Enoch quiet cue touched ambient keywords** (안개/목뒤) → "dormant re-activation independent of current cue" not cleanly testable. Fixture limitation, not a regression.
- **High variance / small sample (n=3).** D2 modern-quiet ranged 1858–4730 across 3 reps. n=3 is insufficient to tightly distinguish medians; the length signal is consistent in direction across all 4 fixtures but noisy in magnitude. Medians should be read as indicative, not precise.
- **No regression** in: provenance (item 10), memory-origin reactivation (item 11), sequential cache stability (item 13), technical fallback (item 14), archive selector (item 8), CORE-only integrity (item 9), active-investigation lore retention (item 6).

---

## Final verdict (exactly one)

### **B. PARTIAL — LENGTH/DEPTH-FILL FOLLOW-UP NEEDED**

D2 is technically **safe on every hard gate**: dormant provenance clean (sentinel suppressed, no memory-origin reactivation), sequential CORE-cache hash stable across 3 turns, 0 technical fallbacks (no silent FULL_LEGACY revert), archive selector perfect (1/1, 0 missed/irrelevant), CORE-only does not collapse to bland (identity/personality/voice/immutable world preserved from CORE alone), and active-investigation retained all required world lore (모방형/브레인 포드/침묵 규약/Level 2→3/기생종) with world-NPC autonomy intact.

But D2 does **not** reliably regain long-form **length**: median output −20% vs CONTROL, floor-pass 5/12 vs 10/12, and **worse than D1.1** (2566 vs 3491). The canon-layering branch (removing dormant canon salience) makes the model write **fewer beats** (more static/focused) rather than **deeper-and-longer**. Per-beat depth and voice are maintained (short D2 reps are compact-but-deep, not thin), but long-form is not maintained → the spec's CORE Q1 answer leans **(B) "just get shorter"** (with depth preserved), and CORE Q2 is only **partial** (breadth down + depth maintained, but long-form not maintained). The cost drop is an output-length symptom, not an input-efficiency win.

A **length/depth-fill follow-up** is required before D3 acceptance — e.g., a depth/length nudge that converts the freed breadth budget into more beats / sustained long-form depth, without re-introducing dormant salience. The ACTIVE selector's poor recall (43%, 7 irrelevant) is a secondary retrieval-quality debt to fix in the same follow-up (it leans toward the C rubric but did not block generation, so it is not a hard C block).

Not A (length not regained), not C (generation did not drop required lore), not D (quality/continuity held — voice/identity/lore-coherence preserved), not E (no regression on provenance/cache/fallback; D2 is safe, just shorter).

---

## Self-check (per spec)

- Only canon/archive branch differs across conditions? **Yes** — same fixture/history/cue/model/temp; only canonMode+archiveMode+canary differ. ✓
- reasoning_tokens not confused with visible output? **Yes** — reasoning_tokens=0 in all runs (reasoning OFF); output_chars measured from visible text only. ✓
- Real usage.cost used (not list price)? **Yes** — usage.cost reported directly; cost *split* anchored to real usage.cost via published price ratio (3.25× billing discrepancy noted). ✓
- Short output not auto-scored as low quality; long not auto-scored as high? **Yes** — short D2 reps evaluated as compact-but-deep (not thin); long reps checked for depth not just length. ✓
- Selector quality separated from generation behavior? **Yes** — item 7 (selector: recall 43%) reported separately from item 6 (generation: lore retained). ✓
- User-action intrusion checked? **Yes** — no user-action intrusion; fixtures are scripted RP cues. ✓
- Counterexamples not hidden? **Yes** — D2 rep2 modern-quiet=4730 (deep long-form achieved) and enoch-active D2 lore retention reported alongside the length regression. ✓
- Small-sample (n=3) limits stated? **Yes** — item 15 + variance noted. ✓
- No tuning performed mid-benchmark? **Yes** — no activeMaxChunks/archive-threshold/compiler/selector/prompt/length changes; canary opt-in in benchmark process only. ✓

## Artifacts (kept for D3)

- `data/d2-live/metrics.json` — all 42 runs (per-run tokens/cost/latency/policy/selector P-R)
- `data/d2-live/report.json` — summary (provenance, seqSummary, selector P/R, CORE-only, fallbacks)
- `data/d2-live/*.txt` — 42 per-run output files (full LLM output + metadata header)
- `data/d2-live/REPORT.md` — this report
- Harness: `scripts/_tmp-d2-runner.ts`, `scripts/_tmp-d2-live.ts`, `scripts/_tmp-d2-fixtures.ts`, `scripts/_tmp-d2-enoch-fixtures.ts`, `scripts/_tmp-d2-analyze.ts`
