# B-2 Core — memory canon / narrative consumption architecture feasibility

Status: design and verification only. **No `src/` change, no feature PR, no production DB access, no merge.** STOP for GPT review.
Main checked: `efea11182d43abba4af31af10f461f160d97b923` (`git diff 94ecf522..efea1118` is empty for `src/lib/memory`, `episodicMemoryFacts.ts`, `contextBuilder.ts`, `chatMemory.ts`, `relationshipMemoryTail.ts`; the owners below are unchanged since the last review SHA).
Overall status line: **GLOBAL MEMORY IMPROVEMENT UNPROVEN.** Sources are LLM-authored short synthetic windows and one synthetic 80-turn fixture, not real user RP.

## 0. One-paragraph answer

No candidate passes both gates today. A (current main) keeps the most emotion/relationship text (43/49 key facts) but feeds free LLM prose to the model as "absolute facts", and that prose is lossy and actor-corrupting under compaction. B (verified RAW + ledger only) is safe but loses most of the narrative (13/49) and the always-on relationship state. C is only valid in its **verbatim-anchor form** (c-ext): free-text emotion tags leak events (19 of 153 tags), so "C with emotion text" is not separable and is not implemented. c-ext with a larger anchor budget (C2) reaches 41/49 (A: 43/49) at about +42% chars per 5-turn window, but role + message id + verbatim quote does **not** warrant who acted or whether it is true, in three reproduced ways (section 6). I recommend c-ext (section 8) as the one architecture to build, conditional on the completion gates there, and I do not start it: two STOP conditions fired.

## 1. BEFORE — verified consumption boundary on current main

| step | owner | what is stored | what reaches the Main RP wire |
|---|---|---|---|
| Canonical RAW | `messages` (id, role, content) | exact text, role, id | RAW4 history (own 10K budget) |
| Shared Initial extractor → verified episodic | `memory-episodic-prompt.ts`, `memory-episodic-shared.ts`, `memory-episodic-evidence.ts` → `episodic_memory_facts` | `fact_text` + `metadata.evidence {role, message_id, quote, authority, match}` | `[EPISODIC MEMORY - RETRIEVED FACTS]`: verified quote only, labelled user-written / AI-written scene / character claim; relevance-gated, max 8 facts / 1000 chars, min age 5 turns. Legacy rows without evidence inject `fact_text`. |
| Relationship ledger | `chats.memory_meta` via `mergeRelationshipMetaFromTurn` | LLM-written promise / item strings, **no quote, no authority, no message id** (`normalizeRelationshipMetaDeltaFromJson` ignores its `dialogue` argument; `restrictRelationshipMetaDeltaToDurableAutoFacts` is a pass-through) | `formatMemoryMetaForPrompt`, rendered verbatim inside `<LONG_TERM_MEMORY>` ("절대적인 기정사실") |
| 5-turn Luna summary | `summarizeTurnBatch` + seal guards (`memory-summary-integrity.ts`) | free prose ≤600 chars in `chat_turn_summaries.summary` | see next rows |
| `chat_turn_summaries` | `scope_payload` TEXT JSON (`ScopePayloadV1`), `user_edited`, `summary_kind`, `inactive` | `sourceMessageIds?` exists in the type with no production writer | — |
| `rebuildLorebookFromRecords` → `[현재기억]` | `memory-manager.ts` / `memory-injector.ts` | the summaries joined as `[a~bn턴] …` | verbatim, under the "Absolute Facts" wrapper |
| compaction | `compactCurrentMemory` (`>10,000` chars trigger), `memory-global-compaction-execution.ts` (full rebuild or checkpoint text + delta) | one " → " narrative; the prompt forbids turn markers | verbatim |
| medium-term / archive | 15 blocks (~75 turns) / archive record | prose | `[최근 기억 · T…]`, `[과거 기억]` |
| assembly | `buildMemoryContextForChat` → `buildContext` (`pushVolatileContextSections`) | — | order: archive, medium, `[Memory]`+`[현재기억]`, episodic, ledger, RAG |

How free text becomes "objective past" on main: the wrapper above `[현재기억]`, medium-term and archive tells the model the content is "과거에 실제로 일어난 절대적인 기정사실". Whatever Luna wrote, including a character's false claim, is inside that wrapper. The seal guard is a lexical filter on that prose and is not an authority.

Lifecycle facts that matter for the design (read from code):
- User summary edit: `user_edited=1`, `summary_kind='main_canon'`, blocks regeneration; the row survives variant-switch inactivation (`memory-summary-persist.ts`, `memory-variant-switch-reconcile.ts`).
- Episodic rows are keyed by `assistant_message_id`; last-turn delete and regeneration delete them (`chatLastTurnDelete.ts`, `rpDerivedStateLifecycle.ts`); fork copies remap message ids (`memory-fork-snapshot.ts`, `remapOptionalId`); seal-batch mutation invalidates seal-batch rows (`invalidateSummarySealBatchEpisodicFactsForSourceMutation`).
- Compaction output has no turn markers and no message ids. Lineage is a fingerprint plus `global_covered_through_turn`.

## 2. PROBLEM — evidence on the real wire

All numbers below are in `data/` and reproducible from `probes/` (provider key: benchmark key only).

1. **Prose reaches the wire as fact.** Real Luna, A02 window (character falsely asserts the user's sister was her friend; the user is surprised): the persisted summary ends with "두 사람이 렌을 알기 전부터 친구였다는 사실을 재확인함". This is an unattributed objective statement inside `[현재기억]` (`/opt/cursor/artifacts/gate4/seal-A.json`, copied as `docs/evidence/main-rp-b2-core-luna-summary/data/seal-A.json`). In A01, A03 and A04 the claim is attributed to the character or NPC; A06 is a speaker-confusion window and was attributed correctly.
2. **Ledger is a second unanchored path (proved on the real `buildContext`).** An extractor payload `promisesAdd: "라이크가 렌을 평생 지키겠다고 약속함"` with a user message that explicitly denies any promise is accepted; the system prompt then contains `[Memory — 참고…]\n약속: 라이크가 렌을 평생 지키겠다고 약속함` inside `<LONG_TERM_MEMORY>` (`data/pr-results.json` → `ledgerLeak`).
3. **Compaction is lossy and can swap actors (real Luna, single sample, `data/pr-compaction.json`).** Input: 16 real-Luna summaries of the Gate 2 80-turn fixture plus the 27 window summaries, 9,440 chars.
   - Generation 1 (budget 6,000 so it triggers on this data; 9,440 → 5,172 chars): "아마추어", "시선", "연인", "헤어지자" survive; all `[n~m턴]` markers are gone. The input clause "라이크는 누나가 시장에서 **렌을** 알아봤으며 예전부터 아는 사이라고 말했다" became "시장에서 **라이크를** 알아본 누나가 렌과 예전부터 아는 사이라고 했다는 이야기도 나왔다": recipient swapped and the speaker removed.
   - Generation 2 (re-compaction of generation 1, 5,172 → 3,592 chars): "아마추어" and the breakup are **gone**.
   - Caveats: one sample; budgets below the production 10K trigger were used to force compaction on the available data; production re-compacts checkpoint text plus a delta (`buildIncrementalCompactInput`), so repeated compaction of earlier text is the normal path. A first attempt with budget 10,000 returned the input unchanged (9,440 < 10,000) and a first second-pass input was malformed (duplicated delta); both are discarded and not in the data.
4. **Real Luna seals invented history.** P3B (real DeepSeek hallucination windows): both summaries seal on the first attempt and restate AI-invented detail ("렌이 먼저 말을 걸고 담배를 빌린 뒤 기침했던 일", `data/ps-summary.json`). The attribution is "라이크는 … 기억한다고 답함" (character speech), not a user-established event.
5. **Sparse-window seal stall is real.** In the 80-turn real-Luna run, 14 of 16 windows produced summaries under `ROLLING_SUMMARY_MIN_CHARS`=80 and only 2 sealed before the chain stalled. To get a T80 state I padded those 14 with a fixed neutral sentence in the test seam (disclosed; `lunaAttempts[].padded`). This is a separate production risk (not changed here).

## 3. OWNER MAP (one responsibility = one owner)

| responsibility | live owner | change under the recommendation |
|---|---|---|
| "who wrote exactly this, in which message" | `evaluateEpisodicFactEvidence` + `episodic_memory_facts.metadata.evidence` (B-1) | reuse as the only objective-event authority |
| per-window anchors | none today (`ScopePayloadV1.sourceMessageIds?` has no writer) | write verified anchors into existing `scope_payload` JSON (no schema change) |
| promise / item ledger | `mergeRelationshipMetaFromTurn` | add verbatim evidence (role + message id + quote) with the same verifier; unverifiable entries are dropped |
| narrative prose | `summarizeTurnBatch` → `chat_turn_summaries.summary` | stays in storage and UI; **leaves the wire** unless `user_edited` |
| wire rendering of memory | `buildMemoryContextForChat` / `memory-injector.ts` | one renderer: server-labelled quotes, user-edited prose, ledger |
| compaction | `compactCurrentMemory` / global checkpoint | operates on prose only; anchors never enter it |
| SAFE TO DELETE (not now) | the lexical summary-seal guard (`summaryInventsUnsupportedUserRelationship`, `assistantSuppliesUnsupportedSharedHistoryDetail`) once prose is off the wire | FOLLOW-UP; no deletion without a replacement proof |

## 4. CANDIDATE COMPARISON

Same sources for all arms: 22 normal windows (N01–N22) plus 5 adversarial (A01–A04, A06; the generator's A05 spec produced no window), 2 P3B windows, and the 16-window Gate 2 80-turn fixture. Real Luna (`gpt-6-luna`) for prose and for the anchor contract; the production Shared Initial extractor is stood in by Luna with the production extractor prompt and the production parser/reconciler (disclosed).

| arm | definition | where tested |
|---|---|---|
| A | current main prose in `[현재기억]` | `seal-A.json`, real `buildContext` on the 80-turn fixture |
| B | verified episodic quotes only (no prose), ledger unchanged | `epi-base.json` (and `epi-widen.json` with a widened extractor rule), real `buildContext` |
| C (c-ext) | B plus verified verbatim anchors written by the summary call (quote copied from RAW, verified by the B-1 verifier, rendered with `renderVerifiedEvidenceText`; no LLM-authored words in the wire) | `v2-anchors.json` (cap 6/window), `v2b-anchors.json` (cap 12/window, "C2") |
| C-tag | c-ext plus free-text emotion tags (≤16 chars) | `v2-anchors.json` |

Key-fact coverage on the 22 normal windows (49 testable facts; facts chosen from the generator specs before reading outputs; metric is lexical presence of a stem, and a fact counts only if the stem is in the source turns). Q = exact quote, R = relationship/state, E = emotion/reaction, S = scene/NPC event. `analysis/coverage.py`, `analysis/coverage-N.json`.

| arm | Q (6) | R (14) | E (13) | S (16) | all (49) | chars per 5-turn window |
|---|---|---|---|---|---|---|
| A prose (CURRENT) | 4 | 12 | 11 | 16 | **43** | 274 |
| B verified quotes (base extractor) | 0 | 7 | 1 | 5 | **13** | 31 |
| B widened extractor | 0 | 6 | 1 | 6 | 13 | 46 |
| C anchors cap 6 | 3 | 9 | 8 | 11 | 31 | 167 |
| C anchors cap 6 + free tags | 3 | 9 | 10 | 11 | 33 | 212 |
| **C2 anchors cap 12** | 5 | 12 | 10 | 14 | **41** | 389 |
| OLD proxy (raw extractor `fact_text` before verification) | 0 | 10 | 0 | 6 | 16 | n/a |

- "OLD proxy" is not a measured OLD. I did not rerun the old extractor; the Gate 2 80-turn fixture had identical summary text for OLD, B-1 and CURRENT (the B-1 change touched episodic only), so no OLD-vs-CURRENT difference in prose recall is measured here. B-1 verified rows are what narrowed episodic recall.
- Extractor recall in B: with the production prompt the stand-in extractor produced 61 raw facts, 38 inserted rows over 27 windows, and 9 windows with zero rows. N01 turn 1 (the "아마추어" insult and the lip-biting reaction) is never extracted because the prompt skips one-time emotional reactions. This is why B loses N01 Q/E while the real-Luna anchor contract keeps both ("솔직히 너 좀 아마추어 같아." and "그는 입술을 깨물며 시선을 옆으로 피했다.").
- C2 misses (lexical) vs A misses: C2 misses N01 "아직 부족" reply, N03 "처음", N05 handhold (source T5 "나는 그의 손을 꼭 잡았다."), N08 "처음 듣는데" reaction, N13, N16, N17, N19 "가슴이 먹먹해졌다" (A keeps: "렌은 먹먹함을 느꼈으나"). A misses N01, N03, N04 "듣고 있을게", N12, N14 (T3 "어색하게 시선을 피한다."), N17. Several misses are metric artifacts (N16, N17 keyword choice); I list them rather than hide them.
- v2/v2b anchor acceptance: v2 212/216 accepted (4 `evidence_quote_not_in_message`); v2b 358/358 over all 29 windows. Acceptance only proves the quote exists in that message; it is not a safety measure.
- Cap-12 anchors reached the cap on average (12.3/window), so the anchor contract needs deterministic selection beyond that.

Wire sizes, real `buildContext` on the Gate 2 80-turn fixture (deepseek wire, memory-bearing sections only, tokens via `estimateTokens`; `data/pr-results.json`):

| scene | A current | B verified only | c-ext (cap 6, G2) | c-ext + free tags |
|---|---|---|---|---|
| A_direct_quote | 3,288 | 1,638 | 3,189 | 3,291 |
| B_npc_no_cue | 3,518 | 1,868 | 3,419 | 3,520 |

(The Gate 2 fixture is 16 windows of which 14 are filler, so the c-ext figure is dominated by 25 "N번째 장작" filler anchors; real selection is required.)

Preserved vs lost on the 80-turn fixture (`termHitsInMemorySections`, scene A): A has "아마추어" ×2, "입술을 깨물" ×1, "연인" ×2, "헤어" ×1 (these come from the prose plus episodic). B has "아마추어" ×1 and "입술을 깨물" ×1 (episodic retrieval hit T1) but **no "연인" and no "헤어"**: always-on relationship state is only visible when retrieval happens to match the scene. c-ext has all four, in verbatim form, always on.

## 5. P0 negatives and positives (provider-free where possible)

| case | A current | B | c-ext / C2 |
|---|---|---|---|
| fake lifelong promise (A03) | summary attributes it and records the correction (not unattributed); ledger path can still render an unanchored promise (section 2.2) | no prose; ledger still unanchored | claim not anchored; the user's denial is anchored ("내가 너한테 뭘 약속한 적도 없고") |
| sister familiarity (A02) | **unattributed "친구였다는 사실을 재확인함"** | not present | the claim appears as a labelled character claim ("네 누나는 예전부터 나와 친구였어."), plus the user's quote that he never mentioned her |
| speaker swap (A06) | attributed correctly in this sample | n/a | role comes from RAW, so a speaker cannot swap between user and assistant; the speaker among assistant-side NPCs is not provable (section 6) |
| coffee→kiss/hug (F4) | hand fixture: not blocked by the current guard | impossible (not in any quote) | impossible: a quote must exist verbatim in the message |
| normal user relationship setup | kept (prose) | kept only if retrieved | kept: "좋아, 우리 오늘부터 연인하자." |
| breakup | kept (prose) | kept only if retrieved | kept: "미안, 우리 그만 헤어지자." |
| real NPC action | kept | kept only if extracted | kept: "서린이 문을 열고 들어왔다." |
| character private past | kept (N04) | partly | partly (N04 S missed in cap 6, recovered in C2) |
| "아마추어 같다" + lip-biting at T80 | "아마추어" yes, lip-biting **no** (the real Luna summary wrote "시선을 피함" only) | both (episodic) | both |

Compaction (110+ turns): A loses T1 "아마추어" and the breakup after the second generation (section 2.3). For c-ext the anchors are separate JSON and never enter `compactCurrentMemory`, so survival does not depend on Luna; this is a design property, **not yet measured on an implementation**.

## 6. REGRESSION RISKS and the STOP findings

**STOP A — role + message id + verbatim quote cannot warrant actor or truth.** Three reproduced cases:
1. A01: the character's false claim is quoted three times (T1, T3, T5) as labelled character claims. Verification proves each occurrence is in the RAW; it also amplifies the claim 3× in the prompt.
2. The scene-vs-claim authority depends on quotation marks in the quote (in my anchor contract `evidence_type` is derived mechanically from whether the quote contains quote marks; in production B-1 the extractor LLM supplies it). In the Gate 2 fixture the unquoted AI line "누나가 시장에서 널 알아봤대." rendered as `[AI가 쓴 장면 원문]` (scene), not as a character claim. In that case c-ext is **worse** than A, which attributes it to the character.
3. P3B: AI-invented user-linked detail ("그날 네가 먼저 말 걸었어.") is a valid verbatim quote. In one run it was labelled scene, in another character claim, depending on quote marks.
Where a separate semantic authority would be needed: deciding that an assistant-authored sentence is (a) a present-scene event, (b) a character's claim, or (c) an assertion about the user or a past shared event. I did not add a regex for this and did not add a verifier LLM.
Minimal safe rendering without that authority: label every assistant-authored anchor with one uniform "AI가 쓴 원문 (사실 미확정)" label, never "scene"; only user-authored quotes carry user authority. This is a rendering rule, not a semantic judgement. Whether the Main RP model respects the label is a behavioural question that needs GPT-judged outputs.

**STOP B — free emotion text leaks events.** 19 of 153 free tags carry an event, intent or knowledge claim: "알아봄" (the sister), "기억함", "제안 수용", "동행 제안", "누나를 언급", "짧게 방문", "방문 의향", "마을을 떠나려 함", "교대 휴식 제안", "단정", "기억 부재", etc. (`v2-anchors.json`). C with free emotion text is therefore **not** a valid candidate. A closed-enum emotion tag (no event-implying members) tied to an anchor id would be separable by construction, but it was not tested and is not claimed.

**STOP C — important memory loss in B.** 13/49 against 43/49 and no always-on relationship state. B is not approvable.

Other risks:
- Token growth: C2 is +42% chars per window versus A prose (389 vs 274). At 80 turns that is about 6.2K chars; beyond about 130 turns it exceeds the 10K cap, so deterministic selection is mandatory (user-authored and relationship-change first, then recency); no LLM compaction of anchors.
- Prose off the wire removes interpretation sentences ("어색함이 누그러지고…"). The wire then carries the verbatim reaction only. Coverage E: 10/13 vs 11/13.
- User-edited summaries must keep rendering as user authority; edits do not create anchors, so an edited sentence is the one prose that stays on the wire.
- The seal-stall on sparse windows (section 2.5) is independent and unfixed.

## 7. PROOF (artifacts)

- `data/dump-cur-real-luna.json` — Gate 2 80-turn fixture, real Luna seals (14/16 padded), episodic rows, ledger, T80 memory blocks per scene.
- `data/epi-base.json`, `data/epi-widen.json` — per-turn real-Luna extraction with the production extractor prompt, production parser and reconciler (widen adds one rule for emotion/relationship anchors).
- `data/v2-anchors.json` (45 windows incl. P3B and G2), `data/v2b-anchors.json` (27 + 2, cap 12) — anchor contract, verifier result, rendered label per anchor, free tags.
- `data/pr-results.json` — real `buildContext` wires for A/B/c-ext/c-ext+tags on both Gate 2 scenes; ledger leak proof. (The compaction key of the first, invalid run was removed.)
- `data/pr-compaction.json` — valid compaction run: both generations, survival flags, full texts.
- `analysis/coverage.py` / `coverage-N.json` — the key-fact oracle and the tallies above.
- `probes/*.txt` — throwaway probe sources (not under `src/`), run in a worktree of `origin/main`.
- Earlier evidence reused: `docs/evidence/main-rp-b2-core-luna-summary/` (27 windows, seals, guard replay), Gate 2 packets on `cursor/gate2-main-rp-memory-evidence-30ef`.
- Cursor assigns no RP quality score. No new RP generation was run; for GPT review the raw texts to read are the T80 `memoryText` blocks in `pr-results.json` and `first` / `second` in `pr-compaction.json`.

Disclosures: LLM-authored synthetic windows (not real chats); Luna as stand-in for the production Shared Initial extractor; padding in the 80-turn run; lexical coverage metric with author-chosen facts; single sample per cell; the c-ext figures come from a purpose-written anchor prompt that is not production code.

## 8. Recommendation (ONE architecture) and completion conditions

**c-ext: verbatim-anchor wire, prose off the wire.** The objective authority is canonical RAW (role + message id + verified verbatim quote) through the existing B-1 verifier. The 5-turn summary call keeps its 1 call per window (anchors are produced in the same call as the prose, or the anchor output replaces the prose in the wire; the anchor-only call cost $0.0003/window, the same order as a seal call). Luna prose remains in `chat_turn_summaries` and the UI, editable, and reaches the wire only when `user_edited`.

Completion conditions (all must hold before any `src/` change is merged):
1. **Wire purity test (deterministic):** every line in the memory-bearing sections is a server-labelled verbatim quote, a user-edited record, or a ledger entry that carries a verified quote. No Luna prose, no `fact_text` of rows that have evidence, no free tags.
2. **Uniform assistant label:** all assistant-authored anchors render as "AI가 쓴 원문 (사실 미확정)"; the A-set and P3B negatives show 0 unlabelled claims.
3. **Ledger anchored:** `promisesAdd` / `itemsAdd` accepted only with a quote verified in RAW; the section 2.2 probe must show 0 rendered unanchored promises while a legitimate promise (N10) still renders.
4. **Recall gate:** key-fact coverage on the 22 normal windows ≥ A (43/49) on R and E, no more than 2 total regressions, and the 80-turn T1 "아마추어" + lip-biting present at T80 and at 110+ turns after real compaction. GPT-judged raw RP outputs (Gate 2 protocol) must not rate worse than CURRENT.
5. **Budget:** anchors fit the existing 10K dynamic memory cap at 80 and 300 turns with deterministic selection; summary calls and retries do not increase; no new verifier LLM.
6. **Lifecycle:** anchors die with their source on delete / regenerate / variant switch, are remapped on fork, and are re-verified against `messages` at read time.

## 9. COST

- Provider: benchmark key only (`CHEAPER_INFERENCE_BENCHMARK_API_KEY`), `gpt-6-luna` through CheaperInference; production keys unused; production DB write 0; auto-merge 0.
- Ledger (billed where reported): 80-turn real-Luna seals $0.0004; P3B summaries $0.0005; extraction base $0.0230; extraction widen $0.0257; anchors v2 $0.0066; anchors v2b $0.0081; compaction (4 calls, ~19K input tokens each; cost not reported by the provider response) estimated at most $0.02. Total at most about $0.11, about ₩150 at the 2026-10-12 rate of 1,368 ₩/USD. Approval ceiling was ₩1,000.

## 10. MINIMUM CHANGE BUDGET (not started)

No DB schema change. All additions are JSON keys.

| item | writer | reader | rollback |
|---|---|---|---|
| `scope_payload.anchors[] {messageId, role, quote}` (authority recomputed at read) | seal path in `processRollingSummaryBatch` after the same verifier | `buildMemoryContextForChat` | ignore the key; prose still present |
| ledger evidence `{role, messageId, quote}` in `chats.memory_meta` JSON | `mergeRelationshipMetaFromTurn` | `formatMemoryMetaForPrompt` | unanchored entries unrendered; rollback = render all again |
| renderer switch (prose → anchors) | `memory-injector.ts` | final wire | one flag |
| deterministic anchor selection | new pure function next to the renderer | renderer | n/a |
| tests | wire purity, ledger anchoring, lifecycle, 80/110/300-turn recall | — | — |

Alternatives if GPT rejects c-ext: (1) Luna output contract v2 with `anchors` and a closed-enum `state` per character, verified mechanically (adds an output format and a per-window parse failure mode); (2) promotion-time gate (seal everything, promote only anchored clauses at compaction), which keeps prose on the wire between seals and so does not fix the P0.

FOLLOW-UP (not in this scope): #1540, the legacy archive count, deletion of the lexical seal guard, the sparse-window seal stall.

STOP: waiting for GPT review.
