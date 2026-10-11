# B-2 Core P0: summary persona-name contract -- investigation result (STOP, no code change)

Main SHA: `4c1c2302bd26e10a09593f2e831da0f4c5106add` (fetched at start of this task). Classification: **NOT PATCHED. STOP.** Nothing in `src/` changed. Provider POST 0. Production DB write 0.

## BEFORE

On live seal the persona guard receives a bare name (`"렌"`). Fabricated user relationship summaries are accepted and reach `[현재기억]` unlabeled (see `c-prime` evidence in PR #1564).

## PROBLEM (confirmed on current main)

The user-relationship guard in the summary seal path is effectively off on the live path, because its authority owner never learns the persona name.

## ROOT CAUSE

`userPersona` is a labelled-identity contract everywhere except the summary seal callers.

- `src/app/api/chat/route.ts` L1006 `personaDisplayName` is a bare name.
- L1027 `userPersonaPrompt` and L1035 `backgroundPersonaIdentity` (`formatSelectedPersonaIdentityForBackground`) are labelled (`이름/호칭: X`). All background tasks (status widget, suggestions, relationship, episodic) get a labelled value.
- Only the three summary-seal call sites pass the bare name: L1565 (`prepareNonBlockingSummaryForMainRp`), L1584 (`ensureSummaryBarrier`), L2927 (`scheduleDeferredBoundarySummaryAfterCanonFreeze`).
- `resolvePersonaName` (`memory-source-authority.ts` L49) and an identical duplicate `resolveSummaryUserName` (`memory-summary-integrity.ts` L249) both require the `이름/호칭:` line, so both return null for a bare name.
- With a null persona name, `mentionsUser` is true only for the literal words 유저/사용자. Summaries normally name the persona (the summary prompt receives the persona block), so the guard rarely fires.

## OWNER MAP

| Step | Owner |
|---|---|
| persona value | `route.ts` L1006/L1027/L1035; labelled formatter `userPersonas.ts` `formatSelectedPersonaIdentityForBackground` |
| seal callers | `prepareNonBlockingSummaryForMainRp`, `ensureSummaryBarrier`, deferred boundary seal -> `processRollingSummaryBatch` |
| LLM call + retry (<=3) | `summarizeTurnBatch` (`memory-rolling-summary.ts`) |
| guard | `isRollingSummaryGroundedInDialogue` -> `summaryInventsUnsupportedUserRelationship` (stage 1 clause authority via `resolveMemorySourceAuthority`; stage 2 whole-summary lexical `looksLikePriorSharedUserHistory` + `assistantSuppliesUnsupportedSharedHistoryDetail`) |
| reject outcome | 3 failed attempts -> `SUMMARY_EMPTY`, batch pending, retried next request; summary chain is contiguous so later batches wait |
| persist/inject | `chat_turn_summaries` -> `rebuildLorebookFromRecords` -> `[현재기억]` |

## Findings (provider-free; `probes/`)

20 hand-written 5-turn cases in the production summary style (the prompt mandates 음슴체 `~함/~임`): 13 normal (sequence words 이후/그때/그동안/아까/어제/전에, NPC action, character past, user declaration, OOC shared past, attributed claim) and 7 fabricated (fake lifelong promise, sister familiarity x5 wording variants, kiss from coffee). Full table: `probes/results-table.md`.

| persona input | normal accepted | fabricated blocked |
|---|---|---|
| bare name (route today) | 13/13 | 0/7 |
| labelled identity (what a persona-only fix would produce) | **2/13** | 5/7 |

- A persona-only fix rejects 11 of 13 normal summaries, including the "아마추어 같다 + 입술 깨묾 + 이후 자존심이 흔들렸을 가능성" emotion summary, plain NPC door-open, user relationship declaration, character past, OOC shared past, and the attributed character claim.
- Real seal path, 40 turns, stubbed summarizer returning normal summaries (`probes/contract-seal-pipeline-results.json`): bare name sealed 8/8 batches with 8 provider calls. Labelled identity sealed 0 batches; batch 1 (the emotional "아마추어" batch) was rejected 3 times (3 provider calls, no record, `[현재기억]` empty), and since the chain is contiguous every later batch would wait behind it. The stubbed text is identical across retries, so a real LLM may vary wording and pass some retries; that variance is not measurable without provider calls.
- It still does not block the fake lifelong promise or the coffee-kiss (2 of 7 fabricated pass).

## Why the cue judgement cannot be fixed minimally

- Two lexical rules cause the false rejections. (1) `PRIOR_SHARED_HISTORY_CUE` includes in-window sequence words (이후, 그때, 그동안, 어제, 아까, 전에). Stage 2 applies it to the whole summary and pairs it with any mention of the user's name in a different clause. Stage 1 applies it per clause. (2) `ATTRIBUTED_CLAIM_MARKER` matches `말했/밝혔/전했…` but not the 음슴체 forms the summary prompt mandates (`말함`), so legitimate attributed claims lose their exemption.
- Whether "이후" sequences events inside the batch or asserts a pre-existing user-cast history is not decidable from the source text lexically. Both cases have assistant-only tokens, so the stage 2 "assistant supplied detail" check cannot tell them apart. That is the stop condition: normal emotion interpretation and false past cannot be separated from existing source info.
- Fixing it by editing the shared cue/marker regexes would add or remove words in an owner shared with B-1 episodic persist (`clauseNeedsUserAuthority`) and was explicitly disallowed (no regex exceptions or word additions).

## AFTER / REMOVED

No change. Nothing removed. Candidate for later (SAFE TO DELETE, no behavior change, separate scoped change): `resolveSummaryUserName` (identical duplicate of `resolvePersonaName`).

## PRESERVED

B-1 verified evidence, B-2a retrieval and exact dedupe, summary5_raw4, 10K Current Memory, relationship ledger, regen/IF, user edit authority, no extra model calls, no price change. Classification: neither `ROOT_CAUSE_FIXED` nor `SYMPTOM_MITIGATED_ONLY` (nothing shipped).

## REGRESSION RISKS (of the rejected persona-only fix)

- Normal-summary rejection 11/13 -> up to 3x summary provider calls per batch and a stalled summary chain (RAW4-only memory for the stalled range) -- direct emotional-memory loss and cost increase.
- Still leaves promise and kiss fabrication through.

## Limits of this evidence

Corpus is hand-written by Cursor (20 cases), not real Luna output. Stubbed summarizer, isolated DB. It shows the guard's lexical behavior on production-style text, not a real false-rejection rate. A real corpus needs provider calls or a read-only production summary sample, neither of which was done.

## STOP: minimum design alternatives (need approval)

1. **Retarget the guard to what is decidable, then fix the persona input.** Summary guard keeps only the family-participant / hard prior-relationship cue (drop in-window sequence words for summaries) and recognises 음슴체 attribution; callers pass the labelled identity. Simulation on the same 20 cases: 13/13 normal accepted, 5/7 fabricated blocked (promise and kiss still pass). Needs a scoped change to the shared cue/marker owner (touches B-1 episodic predicate), real-corpus validation, and approval. Classification would still be `SYMPTOM_MITIGATED_ONLY`.
2. **Source-linked summary output.** Summary clauses carry turn references; the server deterministically checks cited turn exists, role, and that clause tokens are covered by that role's text. Changes the summary output format and probably needs a storage place for the link to survive compaction; no extra LLM call. Needs approval (format + storage). Only route that can address F1/F3/F4.
3. **Hold the guard and rely on exposure framing plus B-1 evidence.** Leave summary seal as is, keep `[현재기억]` explicitly non-authoritative, and prefer B-1 verified episodic text for objective facts. Zero regression, zero new fabrication blocking. Honest status: false-fact propagation remains.

Awaiting GPT decision.

## Reproduce

Copy `probes/contract-guard-probe.test.ts` and `probes/contract-seal-pipeline.test.ts` into `src/lib/memory/` (they import sibling modules) and run, e.g. `AB_OUT=/tmp/cp node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts --test src/lib/memory/<file>`. They use an isolated test database and a stubbed summarizer; no provider is called.
