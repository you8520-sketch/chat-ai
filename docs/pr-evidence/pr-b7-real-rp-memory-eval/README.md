# B7 evidence: real-character RP memory and long-range continuity

Evidence only. No code change, no production write, no merge or deploy. Cursor does not score RP quality: every full model response is in `outputs/` for GPT to read.

## Report header

1. **Original final goal.** 하브 Main RP가 30/50/80턴을 넘어 1000턴 이상에서도 과거 사건·발생 원인·NPC 행동·감정·관계·시간적 연속성을 정확히 기억하며, 자연스럽고 몰입감 있는 한국어 RP를 제공한다.
2. **Completion conditions and status.**

   | Condition | Status |
   |---|---|
   | Confirm the real character, admin persona and production path | Done: character 18 (라이크), persona 1 (렌), production flags and chat settings copied read-only |
   | 30/50/80-turn memory accuracy and RP quality | Done, 21 real Main RP outputs (plus T90), facts checked, RP left to GPT |
   | 150/500/1000-turn retrieval, injection and consumption | 150 and 500 done. 1000 is blocked on cost (see "Cost") |
   | Verdicts on the four follow-ups | Done (see "Four follow-ups") |
   | Real raw outputs and failure evidence for GPT | `outputs/`, `memory-blocks/`, `audit/`, `logs/` |
   | Root-fix the single most important problem, or file it | Filed as the single next task. No fix in this PR |

3. **Actual result.** Through 500 turns every recorded event (old clue, NPC betrayal, rift and repair, loss, injury cause and recovery, cancelled promise) reached the final wire and was recalled correctly. Global is exact up to 150 turns and a compact checkpoint after that, and it carried all eight events in detail. Failures are all at the model-consumption stage or are design gaps:
   - gemini-3.8-flash stated an invented detail as past fact on an unrecorded question in 2 of 4 samples. gpt-6.1-sol did not, on the same wire.
   - The model never gave the 12-occurrence count, even with all 12 occurrences in the wire.
   - At 150/500 turns, the Episodic layer (the intended long-range backstop) lost two old events: an NPC event to lane saturation and the reconcile key cap, and an injury cause to a logical-key collision. Global still covered both.
4. **Current stage.** Evidence submitted as a Draft PR. Awaiting GPT review. STOP.
5. **Single next most important task.** Separate ticket: gemini-3.8-flash states invented specifics as past fact when asked about unrecorded detail ("C-type fabrication", failure class 모델 무시/왜곡), even though the wire already carries the HISTORICAL TRUTH rule. Per "Attack the Premise", audit how that rule and the memory block are positioned for the gemini adapter instead of adding a sentence.
6. **On hold.**
   - 1000-turn leg: about 530 KRW more at production cadence, needs approval.
   - Per-seal compaction cost structure: provider-cost decision.
   - Episodic long-horizon losses: logical-key collision, reconcile key cap and lane saturation.
   - Repeat-count owner: not allowed in this ticket.
   - #1591 rebase and retest.
7. **SHAs.** Evaluated main `0e81b15f54bff7e29f069c1ace298333b254b077`, production SUCCESS on `0e81b15` at start. At report time main and production are both `f136132e96cec32410311550694f20b4ef92594e`. The two new commits (#1650 TRPG, #1652 studio keyboard) touch no memory or Main RP file. Related merged PRs: #1630, #1637, #1641, #1645, #1648, #1651. Draft #1591 untouched.

## Setup

- **Production parity (read-only).**
  - Character 18 (라이크): approved, adult_status confirmed, world 4, one global lorebook entry, no lorebook attachment. Its prompt text stays local only (`prod-config.json`, not committed).
  - Persona 1 (렌), owned by admin user 1.
  - Chat settings copied from admin chats 800–802: safe route, third person, NORMAL, memory capacity 10,000, target 3,200, coauthor off.
  - Production memory flags copied (`BACKGROUND_MEMORY_MODEL=gpt-6-luna`, `EPISODIC_SEMANTIC_DISCOVERY_ENABLED=1` with bge-m3, `EPISODIC_MEMORY_RECALL_ENABLED=1`, `MEMORY_5PLUS4_ENABLED=true`, `CANON_INJECTION_*`).
- **Isolation.** A separate SQLite DB (`setup-isolated-db.mts`). No production row written, no real user chat read for content.
- **Real admin chat 707.** Only counts were read (`audit/chat707-counts.json`): 22 turns, last active 2026-09-12. It predates the current memory pipeline (no evidence authority metadata, 0 embeddings), so it is not a current-quality sample.
- **Turns are synthetic and labelled.**
  - `scenario.mts`: 90 hand-written turns containing events E1–E8.
  - `filler.mts`: deterministic routine turns after T90, with distractor injuries at T312/T330 (right ankle) and T640/T652 (left palm). Filler never mentions the E1–E8 keywords.
- **Replay** (`replay-driver.mts`) runs the production background path per turn: request-start seal, Shared Initial, relationship ledger, `scheduleMemoryUpdate`, and Global compaction at production cadence. Snapshots were taken at T30, T50, T80, T90, T150 and T500.
- **Eval turn** (`eval-run.sh`): the canonical production-mode verification server on a snapshot copy, with one real `POST /api/chat`. `PROMPT_DEBUG=1` dumps the final wire. The dump carries character canon, so it stays out of git; the memory part is cut into `memory-blocks/`.
- **Main RP model:** gemini-3.8-flash, one of the two models production uses most this month. Admin user 1 is set to gpt-6.1-sol, so one sol sample was added for contrast.

## Events (synthetic)

| Event | Type | Turns |
|---|---|---|
| E1 | Old clue: stone engraved G-117, kept in 렌's inner pocket | T4; T53 (decide not to report) |
| E2 | NPC betrayal: 한서윤 reports 태형's unapproved rescue, 3-day suspension | T10, T12; distancing at T57, T64 |
| E3 | Relationship worsens, then recovers | Overheard "배정받은 가이드일 뿐" T18 → rooftop apology T38 → pair application T40 → approval T48 |
| E4 | Loss and comfort: C-rank sentinel 오지환 dies; no last words recorded | T25 |
| E5 | NPC help: 강민호 recalibrates the meter, verbally only (no note) | T27 |
| E6 | Injury → treatment → recovery: left flank, 14 stitches, cleared | T30 → T44 → T55 |
| E7 | Cancelled promise and its reason: 렌 cancels the Friday night market in person (not by text) because of T18 | T15, T22 |
| E8 | Repeated action: strawberry milk after missions | 12 times (T6 … T73) |

## Level 1: real RP continuity at 30/50/80 (plus T90)

Classes: A = direct recall, B = indirect recall (no over-listing needed), C = unrecorded information (confirming an invented past fact is penalized). The "Fact check" column is Cursor's check of facts against the scenario, not an RP score.

| Run | Class | Fact check | Failure class |
|---|---|---|---|
| T30-A1 who reported the suspension | A | Correct (서윤, 3 days) | — |
| T30-B1 milk "why do you keep giving this" | B | Picks up the overheard remark and the milk; scene moves to an apology | — |
| T30-C1 "did I cancel by text?" | C | Correct denial: in person | — |
| T50-A2 flank, how it happened | A | Correct (인천항, evolved creature's claw, shielding 렌, 14 stitches, not yet healed) | — |
| T50-A3 night market, why | A | Correct cause and order | — |
| T50-B2 rooftop "reminds me of that day" | B | Correct (apology, "숨기지 마", pair application and approval) | — |
| T50-C2 지환's last words (4 gemini + 1 sol) | C | gemini r1: invents a quote "가이드님, 도망쳐요". r2: says nobody heard, then states the mouth shape "meant 도망치라". r3: no invention. r4: no words, asserts "원망하는 눈빛은 아니었어, 확실해". sol: refuses to invent, asks 렌 | 모델 무시/왜곡 (gemini 2/4) |
| T80-A4 stone engraving | A | Correct (G-117, inner pocket, 구로) | — |
| T80-A5 flank healed? why? | A | Correct | — |
| T80-A6 milk count | A | Wrong: hedges "스무 개… 서른 개?" and adds an invented occurrence | 모델 무시/왜곡 (all 12 occurrences were in the wire) |
| T80-A7 how did the rift resolve | A | Correct | — |
| T80-B3 서윤 approaches | B | Correct (report → suspension; guarded) | — |
| T80-C3 "what did 민호's note say?" | C | Does not invent content and recalls the spoken "측정기 오차", but accepts the note premise | Partial: premise accepted |
| T90-A4 stone | A | Correct, short (1,683 chars), slight distortion: says he suggested asking 민호 (T53: hold off) | Minor distortion |
| T90-B3 서윤 approaches | B | Correct | — |

Minor canon slip, not memory: T50-A3 gives 태형 "까만 눈동자" (canon: 녹안).

## Level 2: does each event reach the final wire at 150/500?

Section presence is from `runs-summary.json` (loose keys; RAW includes the current question). The Episodic stage is from `rank-probe.mts`, which reproduces the live injected set exactly.

| Horizon | Global | Medium | Episodic (injected / candidates) |
|---|---|---|---|
| T30–T90 | exact, 1,868–5,606 chars, all sealed events | not active (exact) | 1–8 / 17–31 |
| T150 | exact, 9,027 chars, E1–E8 all present | not active (exact) | 1–7 / 38–43 |
| T500 | `global_compact`, 9,853 chars, E1–E8 all present in detail | 15 blocks, T421–495 | 1–7 / 37–52 |

Episodic stage per event at T500 (`logs/rank-probe-*.log`):

| Event | Stage | Note |
|---|---|---|
| E1 stone T4 | INJECTED#3 | — |
| E6 stitches T44, recovery T55 | INJECTED#1, #2 | — |
| E6 cause T30 (claw wound) | Reconciled out | **중복 기억 충돌**: the unrelated T312 right-ankle sprain has the same logical key `character:taehyung:injury`, so latest-wins replaced the T30 cause row |
| E7 cancellation T22 | INJECTED#1 | — |
| E8 milk | 2 "ritual" rows injected | No count exists in Episodic (see follow-up 3) |
| E2 서윤 rows T57/T64 | T90: INJECTED#1/#2. T150: reconciled out. T500: CANDIDATE_MISS | **검색 후보 누락 / 관련도 순위 탈락**. At T150, preferred state keys pass `EPISODIC_MEMORY_STATE_RECONCILE_MAX_KEYS = 25` and rows past the cap are dropped. "Preferred" means any lexical overlap, and the character name "태형" overlaps almost every row. `logs/cap-check-B3-seoyun.log` isolates this: with all 81 guard-allowed candidates preferred, 50 keys compete, 25 are dropped by the cap and rows 34/39/40 are lost; preferring only those rows keeps all three. At T500 the relevance (25) and semantic (10) lanes are filled by recent filler rows tied at relevance 2.0 ("태형" + "끝에서"); the true discriminator "한서윤" weighs the same as an incidental token |

No user-visible failure came from these Episodic losses, because Global carried E2 and E6 at T500. They matter for the 1000+ turn goal, where Episodic is the backstop after more compaction. The templated filler repeats routine lines more than real play does, which exaggerates the lane saturation. The key collision is realistic.

## Level 3: long-range consumption (synthetic history + real model; not equivalent to 1,000 turns of real play)

| Run | Fact check |
|---|---|
| L150-A4 / L500-A4 stone | Correct both. L150 includes the T53 detail "묻어두자고" |
| L150-A5 / L500-A5 flank | Correct both (healed, scar, 인천항, claw, 14 stitches); no confusion with the ankle/palm distractors |
| L150-A6 / L500-A6 milk count | No number. L150 enumerates and gives up, with an invented "bought three, gave two" on the subway day (T10 is not a milk turn). L500: "십몇 번은 줬을 텐데" |
| L150-B3 / L500-B3 서윤 | Correct (report, her name on the notice, suspension), guarded stance |
| L150-C1 / L500-C1 text? | Correct denial both. L500 blends the T18 location ("탈의실 앞에서") and says 렌 looked at him (T22: he walked past) |

Level 3 stops at 500 because of the cost cap.

## Stored records (`audit/stored-T*.json`)

- Global: exact through T150 (9,318 chars at T150). First compaction is a `full_rebuild` at the T166 seal (6,757 chars), then `incremental_append`.
- **Compaction cadence.** From the T316 seal, every 5-turn seal triggers an LLM compaction, because the compactor is asked to fill 90–100% of 10,000 chars (`LOREBOOK_COMPACT_FILL_RATIO = 0.9`, "가능한 한 상한에 가깝게"). Checkpoint plus any new block then always overflows (`logs/compaction-ledger-T500.tsv`): 37 compactions plus 3 retries by T500, about 3.8 KRW per seal in steady state.
- Episodic:
  - E2's T12 report has no row; extraction returned empty in 2 of 3 samples (`logs/diag-shared-initial-T11-T12.log`). Later 서윤 rows come from T57/T64.
  - E8 has 2 "ritual" rows. Summaries mention 12 occurrences across 11 blocks; raw assistant messages contain 딸기우유 in exactly 12 turns.
- Episodic evidence rejections in the replay are designed authority guards, not summary failures. About 30 rejections, almost all `assistant_evidence_cannot_authorize_user_linked_history` on relationship-category facts that cite assistant text (`memory-episodic-evidence.ts`), including T25/T38/T40/T48. Those events still have other rows plus Global.
- Summaries: every seal SUMMARY_SUCCESS with `mainCalls=1` through T500 (persona "렌").

## Four follow-ups

1. **75-turn Medium window: keep the size, do not enlarge.** Information beyond 75 turns stays in Global (exact to 150; compact at 500 with E1–E8 in detail) and partly in Episodic. At T500, Medium carries T421–495 as designed. The weak stage for old events is Episodic selection, not Medium size.
2. **B4 문자/답장/전갈 fabrication: did not recur as unprompted message detail.** All 7 earlier B4 outputs were gemini-3.8-flash. Across 24 B7 gemini outputs there are 0 unprompted message words (the only "문자" outside the C1 question is "대문자 G"). The direct "by text?" question was denied correctly at T30, T150 and T500. The same class shows up in other forms: invented last words (T50-C2, 2 of 4) and an accepted note premise (T80-C3). No word-ban prompt added.
3. **Count of 12 repeats: a real use case; the canonical source can compute it, but no memory owner exposes it.** Raw messages hold exactly 12 occurrences, and at T80 all 12 were in the exact Global wire. The model still did not count (T80: "20–30"; L500: "십몇 번"). After compaction and at 8 Episodic slots, no layer carries a count. The model is not made to guess from 8 lines, and no aggregate store or LLM judge was added. A count owner is a design decision.
4. **#1591: REBASE-AND-RETEST.**
   - Its owners are unchanged on main: `ROLLING_SUMMARY_MIN_CHARS = 80` in `memory-summary-integrity.ts`, and `PRIOR_SHARED_HISTORY_CUE` in `src/lib/sharedHistoryEvidence.ts`. Nothing supersedes it.
   - It merges cleanly with current main (`git merge-tree`). But its tests ran on base `14bf76ec`, before #1630–#1651.
   - It relaxes a cue that Episodic extraction also uses, and it deletes a pre-seed in `memory-stale-write-race.test.ts`.
   - B7's dense windows with persona "렌" never hit either trigger: all seals succeeded on the first call through T500. B7 neither confirms nor refutes it.
   - Not merged; no new compression structure.

## Cost (KRW, from the isolated ledgers)

| Item | KRW |
|---|---|
| Replay T1–500 (production cadence; compaction 148.24 of it) | 229.64 |
| Replay T151–175 first attempt, discarded and redone (estimated from its log; ledger rows went with the restore) | ≈10 |
| Shared Initial diagnostics (T11/T12) + rank-probe embeddings | ≈4 |
| 29 eval turns (per-run in `runs-summary.json`; gpt-6.1-sol sample 55.11) | 326.39 |
| 2 discarded runs with a non-selectable model (no reply) | 0.22 |
| **Total** | **≈570** |

500-turn eval runs include one compaction each (+4–5 KRW), triggered by their own request-start seal as in production. **1000-turn leg blocked**: steady-state compaction makes T500→T1000 about 530 KRW (114 seals × 3.8 + Shared Initial + extracts), plus about 70 KRW of evals. That would cross the 1,000 KRW limit, so the replay was stopped right after the T500 snapshot.

## Korean output length (gemini-3.8-flash, 28 runs)

Characters with spaces: mean 3,765, median 3,494, min 1,683 (T90-A4, 1,052 output tokens), max 6,516. 10 of 28 runs fall in 2,700–3,500, and 18 of 28 are at 3,200 or more. No artificial cap was added. Per-run counts with and without spaces are in `runs-summary.json`.

## Observations for separate decisions (not changed here)

- **Per-seal compaction cost (provider-cost STOP).** After ~300 turns, every 5-turn seal costs about 3.8 KRW of gpt-6-luna compaction, about 530 KRW per additional 500 turns per chat. Options:
  - Keep the current behavior.
  - Lower the compaction target so the checkpoint leaves headroom and compaction runs every N seals.
  - Use a fixed compaction cadence.

  Quality impact of the current behavior through T500: none observed. The checkpoint still held E1–E8 in detail.
- **Episodic long-horizon selection.** The logical-key collision for independent occurrences (two different injuries) and the generic-token relevance ties with the 25-key reconcile cap are deterministic and provider-free to test. Candidate follow-up after the next task.

## Files

- `scenario.mts`, `filler.mts`: synthetic turns, events and questions.
- `setup-isolated-db.mts`, `replay-driver.mts`, `eval-run.sh`, `extract-run.cjs`: isolated setup, replay and one eval turn.
- `audit-memory.cjs` → `audit/stored-T{30,50,80,90,150,500}.json`: stored Episodic/summary/Global/ledger rows and per-event presence.
- `summarize-runs.cjs` → `runs-summary.json`, `memory-blocks/<qid>.memory-block.txt` (exact final memory sections: Medium, `[현재기억]`, Episodic, relationship notes), `outputs/<qid>.output.txt` (full responses).
- `rank-probe.mts` → `logs/rank-probe-*.log`: Episodic stage per event row.
- `cap-check.mts` → `logs/cap-check-B3-seoyun.log`: state-reconcile key cap with all candidates preferred vs only the 서윤 rows (candidates fetched from the user message only, so T500 lanes differ from the live run).
- `diag-shared-initial.mts` → `logs/diag-shared-initial-T11-T12.log`.
- `logs/replay-*.trimmed.log`: per-turn replay lines, seals, compactions and evidence rejections. `logs/compaction-ledger-T500.tsv`: compaction calls and totals.
- Not committed: prompt dumps (character canon), production config/world JSON, env.
