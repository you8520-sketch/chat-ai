# B-2 Core — real Luna summary verification (STOP, no code change proposed)

Main SHA verified: `4c1c2302bd26e10a09593f2e831da0f4c5106add`.
Result: **no safe, summary-scoped, single-owner, narrow-diff fix was proven. No `src/` change is proposed and no P0 PR is opened.** The candidate patch that came closest is kept as evidence only (`probes/candidate-C2r-NOT-APPLIED.patch`).

Classification of everything below: real provider output (Luna) plus deterministic guard replay. Only the seal-pipeline rows are measured on the real `summarizeTurnBatch → processRollingSummaryBatch → chat_turn_summaries → rebuildLorebookFromRecords` path. Nothing here is a claim of improved real-RP quality.

## Sources and cost (disclosure)

- No stored real Luna summaries existed in the repo/evidence, so sources were generated: 27 five-turn windows (22 normal "N", 5 adversarial "A") written by an LLM, **not real user chats**. Windows are short. The "A" sources contain an assistant that asserts false shared history; the user pushes back. They are not leaks from production.
- The active summary model is `gpt-6-luna` through CheaperInference (benchmark key; production keys unused). Production DB was never touched; all seal runs use `installIsolatedTestDatabase`.
- Calls: 101 seal-pipeline provider calls recorded (A 27, B 43, C 31) plus ~28 generation calls and ~15 discarded C0 calls. Measured spend with ledgers: $0.0118 (generation, second run) + $0.0161 (seal runs, only calls that reported billed cost). Upper bound at $0.0006/call is under $0.10, i.e. well under ₩1,000 (about ₩100–140).

## Current-main owner map (re-verified)

| responsibility | owner today |
|---|---|
| persona name extraction from `이름/호칭:` | `resolvePersonaName` (`memory-source-authority.ts`) |
| same parser, duplicate | `resolveSummaryUserName` (private, `memory-summary-integrity.ts`): **SAFE TO DELETE** — one reader, `resolvePersonaName(...) ?? resolveSummaryUserName(...)`, so it is dead whenever the first parser works |
| clause authority (hard cue, family tie, soft cue, attribution) | `clauseNeedsUserAuthority` / `resolveMemorySourceAuthority` — shared by episodic B-1 (`memory-episodic-evidence.ts`, `episodicMemoryFacts.ts`) and summary seal |
| whole-summary soft-cue + assistant-detail heuristic ("stage 2") | `summaryInventsUnsupportedUserRelationship` in `memory-summary-integrity.ts`, on top of `assistantSuppliesUnsupportedSharedHistoryDetail` |
| seal summary persona input | `route.ts` three call sites pass bare `personaDisplayName`; every other background caller passes the labelled `backgroundPersonaIdentity` |

Root cause reproduced: bare persona → `resolvePersonaName` returns `null` → the persona-name mention test never fires → most of the guard is silently off. That is why bare accepts 27/27 real and blocks nothing.

## Real Luna: same summary text through each guard

`replay-table.md`, `data/replay-main.json`, `data/replay-C2r.json`.

| arm | real normal accepted (22) | real adversarial accepted (5) |
|---|---|---|
| A bare persona (current main) | 22/22 | 5/5 |
| B labelled persona only (failed version) | 17/22 (N02, N03, N07, N08, N17 rejected) | 3/5 (A02, A06 rejected) |
| C2r candidate (summary scope + recall-gated stage 2) | 22/22 | 4/5 (A02 rejected) |

## Real Luna: real seal pipeline (one fresh Luna call per attempt, up to 3 attempts)

`data/seal-{A,B,C}.json`, `data/seal-*-cost.json`.

| arm | normal sealed | normal provider calls (22 windows) | normal windows needing retry | adversarial sealed | adversarial calls |
|---|---|---|---|---|---|
| A bare | 22/22 | 22 | 0 | 5/5 | 5 |
| B labelled only | **19/22** (N07, N08, N17 exhausted 3 attempts) | 32 | 6 (N07, N08, N10, N12, N17, N22) | 2/5 | 11 |
| C2r | 22/22 | 22 | 0 | 4/5 | 9 |

Retry detail for B on normals: N07 3, N08 3, N10 2, N12 3, N17 3, N22 2 calls. Luna is stochastic, so B's retry set differs slightly from the deterministic replay; the direction is the same. A seal failure means the 5-turn batch stays unsealed and re-enters the pending-retry path (the chain stall the task warned about).

C2r on the adversarial rows: A02 failed seal (3 attempts) and A01 needed 3 calls. Reading the attempts, the rejected outputs attribute the claim to the character ("라고 단정함", "단언함", "주장함") and A02's summary also records "친구였다는 사실을 재확인함". The rejections are therefore a mix of one borderline objective phrase (A02) and the lexical attribution list not containing "단정함" (A01 attempts 1–2: faithful attribution rejected, 2 wasted calls). This is not a demonstrated block of a leaked fabrication, and it is a retry increase on a realistic RP pattern (a character insisting on a false past), so it fails the "no retry increase" gate by itself.

## Hand fixtures (13 normal / 7 fabricated, deterministic, no provider)

| arm | normal accepted | fabricated blocked | existing test suite |
|---|---|---|---|
| A bare | 13/13 | 0/7 | 101/101 |
| B labelled only | 2/13 | 5/7 | 101/101 |
| C0: stage 2 deleted, summary scope | 13/13 | 5/7 | **8 existing tests fail** (Phase 3B DeepSeek "우산/담배" invented user acts, "mission/market history") |
| C1: stage 2 kept, gated by soft cue in the user window | 11/13 (N07 `아까`, N10 OOC) | 5/7 | 101/101; real normals N03, N17 rejected because the user's own text says "해가 기울기 전에" / "아까는" |
| C2r: stage 2 kept, gated by recall presupposition only | 13/13 | 5/7 | **1 existing test fails** ("rejects assistant-specific mission history when user only established broad shared missions") |

Not fixed by any arm: fake promise (F1), coffee-kiss (F4), speaker inversion (A06 is accepted, not a proven block). The 5/7 are only the "누나" family-tie variants. Do not read 5/7 as a global memory fix.

## Why it stops here

- Stage 2 is the only thing blocking the real Phase 3B DeepSeek hallucinations ("그때 우산…", "첫날 옥상…"), so deleting it (C0) regresses a known production failure class.
- Keeping it makes normal summaries fail unless a gate separates "past before the window" from "sequencing inside the window". Every lexical gate tried (soft cue in user text, recall presupposition) either rejects a normal window (C1) or drops an existing guard (C2r). Cues like 전에/아까/이후/그때 are polysemous; the distinction is semantic.
- Attribution matching is a closed word list on free text; Luna rotates through 주장/단정/단언/고집/확신… so each missed word is a false rejection plus a wasted retry. Extending the list is the "accumulating exception regex" the task forbids.
- Editing the failing existing test to fit C2r would hide a regression, so it was not done.

## What was NOT changed

`src/` is untouched on this branch. The B-1 episodic path and `resolveMemorySourceAuthority` episodic behaviour are unchanged. Fixing only the persona contract (arm B) is confirmed harmful: 19/22 normals seal, 6 seal failures in 27 windows, 10 extra normal calls.

## Structural alternatives (quality-loss risk)

1. **Stop judging free-text summaries with lexical cues; verify objective facts in one owner and keep narrative separate.** Reuse the B-1 episodic evidence record (turn, role, verified authority) as the only source of "objective user↔cast shared history". The 5-turn summary stays a grounded narrative whose clauses cannot be promoted into `[현재기억]` history facts without a matching evidence row. Risk: more facts classified as narrative-only, so some real history is recalled less strongly until the evidence extractor covers it; needs no new LLM and no new storage if the evidence rows already exist, but it changes how `[현재기억]` is assembled.
2. **Structured attribution in the summary output contract** (e.g. each clause tagged speaker/claim-or-event by the summarizer, checked mechanically). Risk: changes the Luna output contract and prompt, a new per-turn failure mode, and a format change that the task rules out without approval.
3. **Block only at promotion, not at seal.** Seal summaries unconditionally (preserving all emotional/relationship continuity, which A shows is complete on 27/27) and enforce the objective-fact rule when summaries are promoted into long-term history / compaction. Risk: unsealed-but-unverified prose stays visible in `[현재기억]` until promotion, so a fabricated clause can influence the next turns; needs a promotion owner that survives edit/delete/regen.

Remaining root design (separate single-owner proposal, not started): free-text summary fabrication, speaker inversion, canon-vs-interpretation, 80–110-turn compaction loss, and derived memory after message edit/delete all share one gap — there is no single owner that says "this sentence is a verified event vs a character's claim vs an interpretation". Alternative 1 is the minimal version of that owner.

## OLD vs CURRENT regression record

No OLD-quality emotional/relationship memory loss was observed in these 27 real summaries under arm A (current main): emotion interpretation, NPC events, exact quotes and the user's direct statements all survive. The only quality loss observed comes from the guard changes (B and C), not from main. No evidence here distinguishes OLD from CURRENT recall at 80+ turns.

## Files

- `data/sources.json` — 27 LLM-authored source windows.
- `data/seal-{A,B,C}.json`, `data/seal-*-cost.json` — real Luna attempts, persisted summaries, `[현재기억]` text, prompts.
- `data/replay-main.json`, `data/replay-C2r.json`, `replay-table.md` — guard replay on identical summaries.
- `data/hand-fixtures-C1.json`, `data/hand-fixtures-C2r.json` — 13/7 fixtures per candidate (C0 numbers recorded from the run log).
- `probes/*` — throwaway probe code (not under `src/`) and `candidate-C2r-NOT-APPLIED.patch`.
