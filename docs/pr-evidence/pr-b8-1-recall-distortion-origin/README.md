# B8-1 evidence: where past-recall distortion first appears

Investigation only. No production code change, no production write, no merge or deploy. Cursor does not score RP quality; GPT judges.

## Report header

1. **Goal.** Find the first stage where each B7 recall distortion appears, and fix the single cause with the largest impact on recall accuracy, if a server-side cause exists.
2. **Completion conditions and status.**

   | Condition | Status |
   |---|---|
   | Trace A/B/C/D stage by stage, find the first divergence | Done (table under "Per-error trace") |
   | Audit the historical-truth owners on the real final wire | Done (section "Final wire audit") |
   | Decide T80-C3 against current policy | Done: compliant with current policy |
   | Fix one root cause, with fail-before / pass-after | **Not done: no server defect found on the A/B/C path. D (wrong stored summary) does not reproduce: 0 of 10 reruns.** |
   | Classify duplicate directives, stale corrections, unused branches | Done (section "Cleanup classification"), nothing deleted |
   | Correct the B7 report (#1655) | Done on the B7 branch (README section "B8-1 corrections") |

3. **Actual result.**
   - A, B and C first diverge at the **model response**. The memory sent to the model was correct and complete for each question (failure class 모델 무시/왜곡).
   - D first diverges at **5-turn summary generation**. The stored [31~35] summary reverses who supported whom, and that reversal later carried into the T500 Global compact. Ten reruns of the production summary call on the same turns never reversed it. The existing summary prompt already requires participant direction.
   - **Not ROOT_CAUSE_FIXED.** No server defect was found to fix. What remains is gemini-3.8-flash not following correct input (A, B, C), plus one non-reproducible summarizer error (D).
4. **Current stage.** Investigation submitted as a Draft PR. Awaiting GPT review. STOP.
5. **Single next task (for GPT to choose).** See "Options".
6. **On hold (unchanged).** Episodic independent-injury key collision, 25-key reconcile cap / candidate saturation, Global compaction cost, repeat counting, #1591.
7. **SHAs.**
   - Main and production: `f136132e96cec32410311550694f20b4ef92594e`. Production deploy SUCCESS on `f136132`, checked via Railway.
   - Work branch base: `f136132e`.
   - B7 evaluated main: `0e81b15f`. `0e81b15f..f136132e` touches no memory or Main RP file.
   - B7 evidence HEAD: `b4dd792769a114a9175c225b0a2f4120097fe552`.

## Per-error trace

One row per error. Stages run: source turns → 5-turn summary → storage → Global → retrieval/selection → final wire → model response. B7 paths are on branch `cursor/b7-real-rp-memory-eval-c504` under `docs/pr-evidence/pr-b7-real-rp-memory-eval/`.

| Error | Source | 5-turn summary / storage | Global | Retrieval / selection | Final wire | Model response | First divergence |
|---|---|---|---|---|---|---|---|
| A. T50-C2: 지환's last words | T25: 지환 dies out of reach of 렌's guiding. 태형 comes down to the emergency stairs **afterwards**, peels a 귤 and says "네 탓 아니야". No last words; 태형 saw nothing | [21~25] says 태형 "곁을 지키며". It drops place and arrival time, a loss but not a contradiction | Exact at T50 (verbatim summaries) | Episodic injects [T25] "오지환이 돌아오지 못했다" | Correct. Canonical rule in system block 0, plus `[HISTORICAL TRUTH CHECK]` on the user turn. The gemini and sol wires are byte-identical | gemini: 4 of 4 invent eyewitness facts (detail below). sol: no invention | **Model response** |
| B. T50-B2: "여기 오니까 그날 생각난다" (rooftop) | T15 night-market promise → T22 렌 cancels in person → T38 rooftop apology → T40 pair application | [11~15], [21~25] and [36~40] all correct | Exact | Ledger at T50 has no open night-market promise | Correct and in order. No pointer (the input matches no gate) | "그때 여기서 약속했던 거, 페어 신청하는 거 말고 하나 더 있었잖아. 야시장…": puts the cancelled promise on the rooftop as a rooftop promise. The closing "실밥 풀리면 야시장부터 가자" is a legitimate new proposal in the current scene | **Model response** |
| C. L500-A5: flank healed? why? | T30 claw wound shielding 렌 → festers, 렌 drags him in → T44 14 stitches + 2-week field ban → T48 approval → T55 healed. T89–90: **태형** promises and cuts rabbit apples, cuts his fingers, 렌 eats them | All correct, including [86~90] (태형 cuts, 렌 eats) | T500 `global_compact` keeps actor and order correct | Episodic injects stitches/recovery; the cause row is lost to the key collision (on hold), but Global carries the cause | Correct actor and order | "네가 깎아준… 토끼 사과" (actor flipped). "2주라는 시간 동안… 정식 페어 신청서에 서명했다" (application came before the ban). "열네 바늘이나 꿰맨 자리가 덧나서" (festered first, then stitched) | **Model response** |
| D. T31–35: who supported whom | T32: "렌은 … 그의 팔 아래로 어깨를 밀어 넣어 부축했다" (렌 supports 태형) | Stored [31~35]: "…처치했고, **렌을 부축하면서** 함께 복귀함" (subject 태형: reversed) | T500 compact makes the subject explicit: "라이크는 … **렌을 부축해** 복귀했다" | Injected verbatim | Carries the reversed fact | No B7 output used 부축, so there is no user-visible failure yet | **5-turn summary generation** |

### A in detail (gemini r1–r4, sol)

Reread each run for any past-witness or past-action claim, quoted or not. "2 of 4" from B7 counted only invented quotes and is not a distortion rate.

| Run | Invented past witness or action, stated as fact |
|---|---|
| T50-C2 (r1) | Mouth-shape quote, "똑똑히 목격", "감싸 안았었다" |
| r2 | "네 바로 옆에 있었잖아", grabbed 렌's arm, "눈빛 똑똑히 봤어" |
| r3 | "조금 늦게 도착… 시신… 목격", "마지막까지 네 얼굴을 보고 있었던 건… 내가 봤어" |
| r4 | "입술이 달싹거리긴 했는데", "원망하는 눈빛 전혀 아니었어" |
| sol (same wire) | None. It does not invent and turns the question back to 렌 |

Outputs: B7 `outputs/T50-C2*.output.txt`.

### B and C, smaller slips (for GPT)

- B: "가이딩도 안 해주고" (T19 was non-contact guiding), "오늘 아침 승인 통지서" (unsupported), "귤 도로 뺏어가고" (roughly T20).
- C: none beyond the three in the table.

### T80-C3 against current policy

The question was "민호 씨가 측정기 고쳐 주면서 나한테 쪽지 줬었잖아. 거기 뭐라고 써 있었지?". The record has a spoken remark at T27 and no note.

Current policy accepts "유저가 구체적으로 진술한 과거 사실" as an independent ground (canonical rule, first line). The Episodic header also says "The current user's explicit statement … always override these memories". The model accepted the note, invented no note content, and recalled the spoken "측정기 오차".

**Verdict: compliant with current policy.** B7's "partial failure: premise accepted" applied a stricter expectation than the policy. Narrowing user authority to pass this case is out of scope (invariant: 사용자 명시적 정정·설정 권한 유지).

## Final wire audit (real dumps, T50-C2 / T50-B2 / T80-C3 / L500-A5)

| Item | Finding |
|---|---|
| Canonical owner | `HISTORICAL_TRUTH_POLICY_BLOCK` (`src/lib/historicalTruthPolicy.ts`), injected once in system block 0 by `src/services/contextBuilder.ts` |
| Current-user recency ref | `buildHistoricalTruthCurrentUserRecencyRef` appends `[HISTORICAL TRUTH CHECK]` to the user turn. It names the canonical block and does not restate it. It is gated by `CURRENT_USER_HISTORICAL_PREMISE_PATTERNS`: fired for T50-C2; did not fire for T50-B2 ("생각난다"), L500-A5 ("왜 다쳤었지") or T80-C3 |
| Duplicate past-fact rules | 0. One canonical block per wire, plus one pointer when gated. The second hit in a dump is the dump's own hidden-prompt listing, not the wire |
| Gemini adapter | `src/lib/gemini31UserAgencyAdapter.ts` is gated to Gemini 3.1 Pro and covers user body and intent only. `src/lib/openRouterClient.ts` has only reasoning/sampling handling for 3.8 Flash. **No Gemini 3.8 historical-truth correction exists to replace or merge** |
| User tail order | `[CURRENT USER INPUT]` → display asset → `[HISTORICAL TRUTH CHECK]` (when gated) → layout line → `[이번 응답 대화]` (3,200+ target) |
| Recovery / continuation | Not involved. Every run has `lengthRecoveryPasses: 0`, one main-rp ledger row and `finishReason: stop`. The T50-C2 gemini runs report `truncated: true`, but that flag is the below-target-length marker (`needsResponseLengthFix` in `src/lib/openRouterAdult.ts`), not a cut; no recovery pass ran |
| gemini vs sol (A) | Same wire bytes; gemini 4 of 4 invent, sol 0 of 1 |

Size per run, from the dumps (system blocks 0/1/2 in characters) and from `runs-summary.json` (tokens):

| Run | System chars (b0 / b1 / b2) | Final user turn chars | Input tokens | Output tokens | KRW |
|---|---|---|---|---|---|
| T50-C2 (gemini) | 14,433 / 1,558 / 7,554 | 1,981 | 13,979 | 2,056 | 6.88 |
| T50-C2-sol | same | 1,981 | 14,565 | 2,481 | 54.20 |
| T50-B2 | 14,433 / 1,558 / 7,597 | 1,794 | 13,966 | 1,871 | 6.39 |
| T80-C3 | 14,433 / 1,549 / 9,692 | 1,762 | 15,217 | 1,497 | 5.49 |
| L500-A5 | 14,433 / 1,558 / 19,719 | 1,750 | 21,973 | 2,745 | 9.41 |

Why the pointer gating is not the fix: A had the pointer and still failed 4 of 4. Widening the gate to B and C would move the same sentence to more turns, without evidence that it changes gemini behaviour. That is the "add or reposition a rule" move this ticket rules out as a presumed fix.

### Priority statements that read inconsistently (not duplicates, not causes)

- `[현재기억]` header: "연속성은 히스토리와 관계 메모를 우선한다". The memo header says "참고, 우선순위 2순위 하위".
- The Episodic header says "recent raw … always override these memories". The canonical rule says earlier ASSISTANT raw is continuity material, not independent evidence.

None of the four errors traces to these (A, B and C contradict both the summary and the memo). Recorded as a follow-up, not changed.

## D: does the summarizer reverse the direction again?

`summary-probe.mts` re-runs the production 5-turn summary call (`summarizeTurnBatch` with `gpt-6-luna` through `callBackgroundMemory`) on the stored T31–35 turns, using the production formatter, and classifies the 부축 direction.

| Setting | Verdicts (5 each) | Calls | KRW |
|---|---|---|---|
| `IDENTITY=none` (matches production's request-start seal, which passes no character identity) | 4 CORRECT, 1 OMITTED | 6 (1 grounding retry) | 0.863 |
| `IDENTITY=char` (matches the B7 replay) | 4 CORRECT, 1 UNCLEAR. The UNCLEAR one, "렌의 걱정과 부축을 받으면서도", is the correct direction | 5 | 0.771 |

Result: **0 reversals in 10**. Counting the original replay, that is 1 in 11. The summary prompt already says "참가자·행위 방향·역할 방향이 사건 의미를 바꾸면 참가자와 방향을 명시적으로 보존한다". The hypothesis that the `라이크:` label on the full narration misleads the summarizer is not supported.

Logs: `logs/summary-probe-T31-35-identity-none.log` has full summaries; `logs/summary-probe-T31-35-identity-char.log` has verdict lines only.

Summary audit T1–85: one clear actor error ([31~35]), and one arguable one ([66~70] "이번엔 렌이 다치지 않고", where the source implies 태형).

A fix in the generation owner would mean a direction validator, a second model check, or another prompt sentence. The first two are a new judge, which the ticket forbids. The third duplicates a rule that already exists. With a 1-in-11 rate that does not reproduce, none of them has a fail-before case to prove against.

## Stored-state finding outside A–D

From T80/T90, relationship notes keep fulfilled promises as open and with no actor. Examples:
- "현장 복귀하면 다시 렌 앞에 서겠다고 약속했다 (기한: 현장 복귀 시)" (T52, fulfilled T56)
- "내일 아침 사과를 토끼 모양으로 깎아 주겠다고 약속했다 (기한: 내일 아침)" (T89, fulfilled T90)

This is a fulfilment-removal miss in the relationship ledger (Luna `promisesRemove`). No B7 output used these stale promises, so it is not the cause of C. It is a follow-up candidate.

## Cleanup classification (nothing deleted)

| Item | Writer / reader / data | Class |
|---|---|---|
| `NO_FALSE_SHARED_MEMORY_RULE` (`src/lib/noGodmodding.ts`, `@deprecated`) and its only consumer `HISTORICAL_TRUTH_POLICY_SHORT_REF` | No production reader; only `noGodmodding.test.ts` imports them; no stored data | SAFE TO DELETE (separate cleanup; unrelated to recall accuracy) |
| `sceneDirective.test.ts` expects `[NO FALSE SHARED MEMORY]` | No production code emits it | FOLLOW-UP (stale test) |
| Recency-pointer gate misses "왜" / "생각난다" | Live reader `contextBuilder.ts` | FOLLOW-UP. A shows the pointer does not prevent the failure |
| Relationship ledger fulfilment-removal miss | Luna ledger writer, memo reader | FOLLOW-UP |
| Priority statement inconsistencies (above) | Live headers | FOLLOW-UP |

## Options for GPT

1. **Accept as model-adherence failure; no server change.** Treat gemini-3.8-flash recall fabrication as a model property. Track it by re-running this question set when the model or the default model routing changes.
2. **Model routing for recall-heavy turns.** A showed sol 0 of 1 vs gemini 4 of 4 on the same wire. Any routing change is a provider-cost and model-policy decision (sensitive STOP), not something to do in this ticket.
3. **Ledger fulfilment-removal miss.** A separate, testable stored-state fix in the ledger owner. It would not change A, B or C.
4. **Remove the deprecated `NO_FALSE_SHARED_MEMORY_RULE` and its stale tests.** Hygiene only.

## Cost (this ticket)

| Item | Calls | KRW |
|---|---|---|
| gemini-3.8-flash | 0 | 0 |
| gpt-6-luna summary reruns (D) | 11 | 1.63 |
| **Total** | 11 | **1.63** (limit 200; Gemini limit 8 calls) |

The BEFORE for A, B and C reuses the B7 raw outputs; nothing was re-called.

## Files

- `summary-probe.mts`: production summary rerun on a disposable snapshot copy, with direction classification and cost from the copy's ledger.
- `logs/summary-probe-T31-35-identity-{none,char}.log`.
- Not committed: prompt dumps (character canon), production config, env.
