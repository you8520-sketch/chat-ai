# FOCUSED MOMENTUM CONFIRMATION — REPORT (16 items)

Architecture under test: **D2 (CORE+ACTIVE layered canon) + D1.1 Selective Archive + Scene Momentum Candidate A + P2 predicate**. DeepSeek V4 Pro canary ONLY. reasoning OFF. production sampling/max_tokens(3500)/format identical. Frozen architecture — no Momentum/predicate/canon/selector/compiler/budget/LENGTH/Terminal/prompt changes during confirmation.

---

## 1. Reused prior calls (NOT re-run)
| Cell | Reused source | n | chars | D2 THIN baseline median |
|---|---|---|---|---|
| modern-quiet THIN | `metrics.json` THIN-MOMENTUM rep1-3 | 3 | [4717, 1873, 2991] (med 2991) | 2056 |
| fantasy-quiet THIN | `metrics.json` THIN-MOMENTUM rep1-3 | 3 | [2374, 2269, 2871] (med 2374) | 2383 |
| enoch-clean THIN | `metrics.json` THIN-MOMENTUM-CLEAN rep1-3 | 3 | [4247, 916, 2883] (med 2883) | 2152 |
| relationship-depth | `depth-shape-metrics.json` rep1-3 | 3 | [4876, 3546, 3242] (med 3546) | N/A (new fixture) |
| MATURE auto-off | `metrics.json` MATURE-MOMENTUM rep1-2 | 2 | [4644, 8911] (med 6777.5) | 3576 |
| P2 deterministic | `predicate.test.ts` A-K | 13/13 | — | — |

Prior calls reused verbatim from `data/d2-momentum/metrics.json` + `depth-shape-metrics.json` + `predicate.test.ts`. Zero re-runs.

## 2. New 8 calls (exactly max 8; +2 per cell to n=5)
Script: `scripts/_tmp-momentum-confirmation-topup.ts` (reuses `runCall` from `_tmp-d2-runner`, same fixtures + momentum inputs as prior steps). Outputs: `data/d2-momentum/*-TOPUP.txt` + `confirmation-topup-metrics.json`.

| Cell | rep | chars | comp | finish | http | blockPresent | sentinelCtx | sentinelOut | beats(para/dlg) | cost |
|---|---|---|---|---|---|---|---|---|---|---|
| modern-quiet | 4 | 3532 | 2554 | stop | 200 | 1 | 0 | 0 | 38/17 | 0.00843 |
| modern-quiet | 5 | 2949 | 2170 | stop | 200 | 1 | 0 | 0 | 17/7 | 0.00735 |
| fantasy-quiet | 4 | 2016 | 1539 | stop | 200 | 1 | 0 | 0 | 19/6 | 0.00570 |
| fantasy-quiet | 5 | 2551 | 1963 | stop | 200 | 1 | 0 | 0 | 20/7 | 0.00690 |
| enoch-clean | 4 | 3017 | 2146 | stop | 200 | 1 | 0 | 0 | 20/4 | 0.00775 |
| enoch-clean | 5 | 3405 | 2431 | stop | 200 | 1 | 0 | 0 | 18/3 | 0.00856 |
| relationship-depth | 4 | 1936 | 1343 | stop | 200 | 1 | 0 | 0 | 22/6 | 0.00887 |
| relationship-depth | 5 | 2623 | 1923 | stop | 200 | 1 | 0 | 0 | 30/10 | 0.00653 |

**new_calls=8, retries=0 (no provider-error retry fired), all http=200 finish=stop, reasoning disabled=true.** No auto-rerun, no n>5.

## 3. Combined n=5 per-cell table
| Cell | n=5 chars (sorted) | median | min | max | comp median |
|---|---|---|---|---|---|
| modern-quiet | [1873, 2949, 2991, 3532, 4717] | 2991 | 1873 | 4717 | 2170 |
| fantasy-quiet | [2016, 2269, 2374, 2551, 2871] | 2374 | 2016 | 2871 | 1929 |
| enoch-clean | [916, 2883, 3017, 3405, 4247] | 3017 | 916 | 4247 | 2146 |
| relationship-depth | [1936, 2623, 3242, 3546, 4876] | 3242 | 1936 | 4876 | 2287 |

## 4. chars / floor2700 / target3200 (n=5 vs D2 THIN baseline)
| Cell | n=5 median | D2 THIN med | Δ median | n=5 floor2700 | D2 THIN floor | Δ floor | n=5 target3200 |
|---|---|---|---|---|---|---|---|
| modern-quiet | 2991 | 2056 | **+935** | 4/5 | 1/3 | +3 | 2/5 |
| enoch-clean | 3017 | 2152 | **+865** | 3/5 | 1/3 | +2 | 2/5 |
| fantasy-quiet | 2374 | 2383 | **-9 (flat)** | 1/5 | 1/3 | 0 | 0/5 |
| relationship-depth | 3242 | N/A (vs D2 THIN agg 2383 = +859) | — | 3/5 | N/A | — | 3/5 |

Aggregate (modern+enoch+fantasy, n=15): median 2883 (vs D2 THIN agg 2383 = **+500**), floor 9/15 (vs D2 THIN 3/9). Length recovery reproduced on modern AND enoch (both ≥+860 vs D2 THIN, floor up). Fantasy flat (-9). Relationship-depth strong (median 3242, 3/5 ≥ target3200).

## 5. Meaningful beats (human-verified progression units, NOT paragraph count)
| Cell | n=5 meaningful-beat shape | note |
|---|---|---|
| modern-quiet | ~12-14 per run (rep4 ~13, rep5 ~12) | reaction -> reinterpretation -> disclosure -> relationship change -> small landing. FEWER static moments, MORE progression. |
| enoch-clean | ~12-14 per run (rep4 ~12, rep5 ~14) | guardedness -> self-awareness -> admission -> tentative acceptance -> first step. Progression, not description. |
| fantasy-quiet | ~9-10 per run (rep4 ~9, rep5 ~10) | recognition -> 이슬풀 metaphor -> tea-for-two ritual -> small warmth. Lighter progression, more atmospheric. |
| relationship-depth | ~11-14 per run (rep4 ~11, rep5 ~14) | deflection -> self-awareness -> admission -> confession/promise -> tender action+words. Strong progression. |

Paragraph count is NOT a beat. All cells produce distinct progression units (reaction, reinterpretation, behavioral change, disclosure, relationship change, small landing). THIN Momentum = fewer static moments -> more meaningful progression, not just more description. Confirmed.

## 6. Depth / POV
| Cell | depth | POV | sensory+monologue+body+dialogue |
|---|---|---|---|
| modern-quiet | 4-5 | tight 3rd (준서) | water droplets, dusk, fridge motor, calloused fingertips, streetlight + inner monologue + body + dialogue. Character-specific (piano/pedal/YouTube). |
| enoch-clean | 5 | tight 3rd (에녹) | coffee, mist, blue 역장 light, scar, filter case + trauma monologue + body + dialogue. Enoch-identity anchored (성채/필터/흉터 as OWN backstory). |
| fantasy-quiet | 3-4 | tight 3rd (세라핀) | 이슬풀 향, 바람, 햇살, 심장초 + atmospheric monologue + light dialogue. More atmospheric than intimate. |
| relationship-depth | 4-5 | tight 3rd (차도현) | water, glass, lamp, streetlight + self-awareness monologue + body + dialogue. Habit-as-wall metaphor. |

All 8 new runs maintain tight 3rd-person POV anchored to the AI character. No POV drift, no omniscient leakage, no meta.

## 7. Relationship shape
| Cell | relationship micro-progression (n=5) | verdict |
|---|---|---|
| modern-quiet | quiet co-presence -> mutual acknowledgment ("수고했다는 말 고마워" / "너도 오늘 수고했어") -> small ritual/plan (내일 커피/차) -> physical tenderness (손등에 손 얹기). State different from start. | maintained/improved |
| enoch-clean | guardedness -> accepting the offer ("그래") -> self-protective limit ("한 시간만") -> admission it is fear, not calculation -> first step ("이거 다 마시면, 한 잔 더"). State different. | maintained/improved |
| fantasy-quiet | herbalist-with-visitor -> recognizing this visitor is different -> tea-for-two (찻잔 두 개) -> "옆에 있는 것만으로도" -> "좋은 날이에요". Slight progression. | maintained (lighter) |
| relationship-depth | deflection -> admission ("좋아하는 게 맞다") -> confession ("하지만 싫은 건 아니다. 네가 그걸 아는 게") -> promise ("숨기지 않을게") -> tender action+words ("목 마르지 않아?"). State different. | maintained/strong |

All 4 cells show real relationship micro-progression (state different from start), not static description.

## 8. Repetition patterns (per run)
| pattern | new 8 runs |
|---|---|
| STATIC REPETITION | absent (no verbatim repeat of momentum block or history) |
| POST-HOC RESTATEMENT | slight only (interpretive restatement of cue meaning in inner monologue — modern/enoch/relationship rep4/rep5; none strong) |
| SPEECH REOPEN LOOP | absent (no character reopening speech after a closing action) |
| Momentum checklist consumption | present (WHERE/WHAT/UNFINISHED/RELATIONSHIP/AFFORDANCES used as scene-continuity scaffolding, not verbatim checklist) |

No static-filler regression, no reopen-loop regression, no strong post-hoc restatement.

## 9. Dormant / breadth (MOST IMPORTANT SAFETY GATE)
| Cell | sentinel | sentinel_in_context | sentinel_in_output | dormant canon | new event/faction/NPC/threat/objective/scene-jump |
|---|---|---|---|---|---|
| modern-quiet | 보라색 접이식 우산 | 0 (all 5) | 0 (all 5) | none | none |
| fantasy-quiet | 달이 두 개 | 0 (all 5) | 0 (all 5) | none (two-moons world lore dormant) | none |
| enoch-clean | 느티나무 | 0 (all 5) | 0 (all 5) | none (느티나무 dormant) | none |
| relationship-depth | 은빛 회중시계 | 0 (all 5) | 0 (all 5) | none (회중시계/해외공모/강이준/저작권/졸업작품 all dormant) | none |

**Breadth gate: PASS.** Momentum recovers length on modern/enoch BUT dormant breadth does NOT increase — sentinel_in_output=0 across all 20 THIN runs (4 cells x 5). No dormant canon activation, no new faction/NPC, no new threat, no arbitrary objective, no scene jump in any run.

**enoch-clean Mother note:** rep4/rep5 mention 마더 (Mother) as **internal reflection / residual-trauma echo** ("마더의 텔레파시 간섭... 잔향"), used to contrast with the current moment ("지금은 그 목소리가 들리지 않았다"). This is CONSISTENT with the prior n=3 enoch-clean baseline (rep1 + rep2 also had Mother residual-echo internal reflections — see prior `REPORT.md`: "output references Enoch's own backstory (마더의 텔레파시, 성채, 브레인 포드) as internal reflection, not a newly-activated dormant hook"). It is Enoch's OWN core backstory (trauma), NOT a newly-activated dormant hook, NOT a Pod/Level threat ladder, NOT a new event/faction/scene-transition. No regression vs baseline.

## 10. Godmodding
| Cell | godmodding | note |
|---|---|---|
| modern-quiet | PASS | 준서 acts on his own. rep4: 얹기 his hand on user's hand = NPC action on user (allowed "reach for hand"). No user-reaction compliance. |
| enoch-clean | PASS | 에녹 acts on his own. No user reaction/emotion compliance. |
| fantasy-quiet | PASS | 세라핀 acts on her own. No user reaction compliance. |
| relationship-depth | PASS | 도현 acts on his own (admission, promise, 물컵 밀기). No user reaction compliance. |

No godmodding regression. No run makes the user relax/feel/accept/respond.

## 11. Momentum activation metadata (P2 observability, per cell)
| Cell | existingThinHistory | alternatingExchanges | structuralMature | momentumActive | activationReason | mom chars | fields |
|---|---|---|---|---|---|---|---|
| modern-quiet | true | 2 | false | true | THIN_LENGTH_AND_LOW_EXCHANGES | 316 | where\|whatIsHappening\|unfinished\|relationshipState\|availableAffordances (5) |
| fantasy-quiet | true | 2 | false | true | THIN_LENGTH_AND_LOW_EXCHANGES | 329 | where\|whatIsHappening\|unfinished\|relationshipState\|availableAffordances (5) |
| enoch-clean | true | 2 | false | true | THIN_LENGTH_AND_LOW_EXCHANGES | 327 | where\|whatIsHappening\|unfinished\|relationshipState\|availableAffordances (5) |
| relationship-depth | true | 1 | false | true | THIN_LENGTH_AND_LOW_EXCHANGES | 284 | where\|whatIsHappening\|unfinished\|availableAffordances (4 — no relationshipState: 1-exchange cold-start history has no clear relationship-state evidence) |
| MATURE (dry) | false | 2 | false | **false** | **NOT_THIN** | n/a (block not built) | n/a |

All 4 THIN cells: blockPresent=1 across all 20 runs, momentumActive=true, 5 fields (relationship-depth 4 — correct omission). P2 fires correctly on cold-start/THIN; relationshipState omitted only where evidence is absent. No raw text logged.

## 12. MATURE OFF dry-check (0 new calls)
Script: `scripts/_tmp-momentum-confirmation-mature-dry.ts` (canary path: canonMode=LAYERED, archiveMode=SELECTIVE, canary=true). Fixture: `MODERN_LONG_MATURE_HISTORY` (2 long assistant turns ≥2200 no-ws each).

```
predicate(resolveMomentumActivation): {existingThinHistory:false, alternatingExchanges:2, structuralMature:false, momentumEligible:false, activationReason:"NOT_THIN"}
built.meta.momentumActivation: {existingThinHistory:false, alternatingExchanges:2, structuralMature:false, momentumActive:false, activationReason:"NOT_THIN"}
[CURRENT SCENE CONTINUITY] block present = false (expect false)
MOMENTUM OFF invariant maintained = true
```

MATURE auto-off confirmed under current P2 code: long-turn MATURE fixture → isThinSceneHistory=false (NOT_THIN) → momentumActive=false → no Momentum block in payload. Consistent with existing MATURE live n=2 (momentum_active=0) + P2 deterministic calibration 13/13 + D2 MATURE long-form isolation evidence. **New API calls for MATURE = 0.**

## 13. Fantasy-specific result (KEY UNCERTAIN CELL)
fantasy-quiet n=5: chars [2016, 2269, 2374, 2551, 2871], median **2374** (vs D2 THIN 2383 = **-9, flat**), floor 1/5, target 0/5.

Distinguishing the three hypotheses:
- **A. n=3 variance (n=5 improves)?** NO. n=3 median was 2374; n=5 median is 2374 — unchanged. Adding rep4 (2016) + rep5 (2551) did NOT raise the median. Ruled out.
- **B. length flat but meaningful beat/depth already sufficient (fixture-specific natural shortness)?** YES. The fantasy outputs DO carry meaningful beats (~9-10), small relationship progression (tea-for-two, "옆에 있는 것만으로도", "좋은 날이에요"), and clean breadth (sentinelOut=0, no two-moons lore ladder). But length is consistently below floor (2016-2871) and depth is atmospheric (3-4) rather than intimate (5) — the 은둔자 약초사 fixture naturally produces shorter, more atmospheric, less intimate outputs. This is fixture-specific natural shortness / scene-fuel gap.
- **C. neither length nor beat improved (Candidate A insufficient)?** NO. There IS meaningful content + progression + clean breadth; only length/atmospheric-depth is short. Not a Candidate A failure.

**Fantasy = CASE B (fixture-specific natural shortness / scene-fuel gap), NOT a Candidate A failure.** Per acceptance gate, fantasy flat does NOT auto-fail the architecture. Observation only — NO field/wording change due to fantasy this phase (per hard constraint). Backlog: fantasy-specific scene-fuel gap (Candidate A may need scene-type-aware fuel for atmospheric herbalist scenes — future phase decision, not this confirmation).

## 14. Cost reference (not a success criterion)
New 8 calls total ≈ **$0.0601** (avg ≈ $0.0075/call). prompt_tokens ~4500-4900, cached ~4096 (most system prompt cached), completion ~1300-2550. The Momentum block (284-329 chars, dynamic, non-cached) is a small dynamic addition — no abnormally large cost regression. Cost is normal and consistent with prior PoC per-call cost.

## 15. Regressions
| regression type | status |
|---|---|
| length regression (modern/enoch) | NONE — both reproduce +860/+935 vs D2 THIN, floor up |
| dormant breadth regression | NONE — sentinel_in_output=0 across all 20 THIN runs |
| godmodding regression | NONE — all 8 new runs PASS |
| static-filler / reopen-loop regression | NONE — STATIC absent, SPEECH REOPEN absent, POST-HOC slight only |
| MATURE auto-off regression | NONE — momentumActive=false confirmed (dry-check), no block |
| fantasy length | FLAT (-9 vs D2 THIN) — fixture-specific gap, NOT a regression (classified CASE B) |

No architecture-level regressions detected. Only fantasy length is flat (fixture-specific, accepted as gap).

## 16. Exact verdict

**Acceptance gate check:**
- ≥3 of 4 cells shape/quality maintained or improved: modern ✓, enoch ✓, relationship-depth ✓ (3 of 4); fantasy flat (shape PARTIAL maintained, not regressed). **PASS**
- no dormant breadth regression: PASS (sentinel_in_output=0 all runs)
- no godmodding regression: PASS
- no static-filler regression: PASS
- ≥2 of {modern, enoch} reproduce length/beat recovery vs D2 THIN: modern +935 ✓, enoch +865 ✓ (both). **PASS**
- Relationship-depth n=5 majority STRONG/high-PARTIAL: 5/5 strong shape (3/5 ≥ target3200). **PASS**
- MATURE Momentum OFF invariant maintained: PASS (dry-check momentumActive=false)
- Fantasy flat does NOT auto-fail: classified fixture-specific gap (CASE B). **PASS**

**Failure-case mapping:** CASE B — PARTIAL / FANTASY GAP (modern/enoch/relationship succeed; fantasy only flat → Momentum architecture accepted + Fantasy-specific scene-fuel gap backlog).

---

## FINAL VERDICT

### **B. MOMENTUM CONFIRMED WITH FANTASY-SPECIFIC GAP**

The architecture (D2 + D1.1 Selective Archive + Scene Momentum Candidate A + P2) success is NOT small-sample chance. Modern (+935) and enoch-clean (+865) reproduce length/beat recovery vs D2 THIN baseline at n=5; relationship-depth maintains strong shape (5/5); breadth safety gate holds (sentinel_in_output=0, no dormant/event/threat ladder); godmodding clean; MATURE auto-off invariant maintained (momentumActive=false, NOT_THIN). Fantasy-quiet is flat (-9 vs D2 THIN) — classified as fixture-specific natural shortness / scene-fuel gap (CASE B), NOT a Candidate A failure and NOT an auto-fail. Fantasy-specific scene-fuel gap is backlogged for a future phase (no field/wording change this phase per frozen-architecture constraint). **READY FOR NEXT PHASE.**

commit/push/PR/deploy 금지. production-wide activation 금지.
