# B35 — real RP recall: evidence index

Starting main `09f337e212d03ddf537ad0b524d6aa803ba64b01` (B34 PR #1718 merged at `6de9019960f4cea39b151531f7f21dcff0343eda`).
No USER point deduction, no production data, no production key, no merge/deploy.

Cursor does not score RP quality here. Raw model text and the input/memory/output evidence are provided for GPT review.

## Files

| file | what it is | REAL / SYNTHETIC |
|---|---|---|
| `a-before-fix-test-output.log`, `a-after-fix-test-output.log` | A1/A2 regression tests: 43 pass / 12 fail on pre-fix `episodicMemoryFacts.ts`, 56 / 0 after the fix | tests on B34 live-run replay + fixtures |
| `run-main-rp-recall.mts` | B2 runner: real `POST /api/chat` route, isolated DB, real Main RP model, real independent Episodic (Luna) | REAL provider calls |
| `main-rp-recall-report.json`, `final-wire-recall-ON.json`, `final-wire-recall-OFF.json`, `final-memory-blocks-recall-ON.md`, `wires/*.json` | B2 raw evidence: stored facts, retrieval probe, injected memory block, final Main RP wire bodies, raw outputs | REAL (6-turn chat) |
| `run-long-horizon-recall.mts`, `long-horizon-recall-baseline.json` | C: 50/500/1000-turn isolated chats plus one 1,050-turn chat, stored through `persistEpisodicMemoryFactsCore`, read through `getEpisodicMemoryForPrompt`, per-stage report; D candidate simulation (`candidateAb`) | SYNTHETIC, no provider call |
| `run-noise-reading-ab.py`, `noise-reading-ab.jsonl` | D reading-stage A/B on the captured Main RP wire (raw outputs) | REAL provider calls (12) |

## A — MUST FIX NOW (root cause confirmed)

- A1: the ledger-owner check treated the attribute names `transfer`/`transferred`/`received` as proof of an item event, so a USER refusal to forward a statement (`statement_transfer_*`) was dropped as `relationship_ledger_item`. Attribute naming now decides nothing on its own for those ambiguous names: they stay ledger-owned unless the text is an information disclosure (statement/record/document + forward/disclose/submit verb) with no possession lexicon. Real item handover/acquisition/loss and promise create/cancel stay ledger-owned (tests). Evidence/quote verification is untouched.
- A2: `ATTRIBUTED_CLAIM_TEXT` lacked directive/permission verbs (명령/지시/허락/허가/허용/금지/제한/요구/요청/경고/당부/선언/거절/거부/승낙), so "볼프강은 …를 허락하고 …를 금지했다" was dropped as `unattributed_character_claim`. Added only those verbs. Speculative inner states and USER-action-as-character stay blocked (tests).
- B34 live provider output (`docs/evidence/b34-pr1718/live-runs-detailed.jsonl`) is replayed through the canonical persist path: all five live runs store exactly `rawFactCount` rows.

## B1 — route / owner path (read from current main)

- `POST /api/chat` (`src/app/api/chat/route.ts`): retrieval `getEpisodicMemoryForPrompt` (`src/lib/episodicMemoryFacts.ts`) -> `buildContext` (`src/services/contextBuilder.ts`, section `episodic-memory-retrieved-facts`) -> Main RP wire.
- Post-turn: `startIndependentEpisodicExtraction` (`src/lib/memory/memory-episodic-independent.ts`) starts after SSE `done`, independent of status widget ON/OFF (`shouldRequestEpisodicInSharedInitial` decides eligibility), and persists behind the generation/epoch/boundary guards; regen and stale generations are covered by the existing B34 tests, now 56/56.
- Recall switch: `episodicMemoryRecallEnabled` — on whenever `MEMORY_FEATURE_ENABLED`, off only by `EPISODIC_MEMORY_RECALL_DISABLED` / `EPISODIC_MEMORY_RECALL_ENABLED=0`.
- Deploy: read-only GitHub deployment API shows production deployment of `09f337e2` (includes B34 `6de90199`) with status `success` at 2026-10-23T13:32Z UTC. Railway itself could not be queried: the injected `RAILWAY_TOKEN` is rejected by the Railway API and the Railway MCP needs interactive auth; no workaround was attempted. Model routing was therefore verified on the real route in the isolated DB (`mainRpWireModel: google/gemini-3.8-flash`), not on production.

## B2 — real 6-turn Main RP recall (same character, admin persona, SAFE)

Turn 1 stores the USER refusal and a character directive; five filler turns follow; the recall question asks what USER said and what the character ordered.
- Memory ON: the injected block holds the verbatim USER quote (`[유저 입력 발췌] “나는 내 진술을 황실 감찰관에게 전달하는 데 동의하지 않았어.”`) and the character-claim quote; the raw output quotes the refusal accurately.
- Memory OFF (same question): the output fabricates a quotation the USER never said.
- Cost: $0.0587 for 23 real provider calls (Main RP + Luna; the turn-1 Main RP reply is a fixture stub), cap $0.25.

## C — long-horizon (SYNTHETIC; no real 500/1000-turn chat exists in this environment)

1,050-turn combined chat with 525 ambient facts, production default minimum recall age (5). The "summary/compression" stage is not simulated (needs paid Luna); only the first 5-turn block is REAL (B2). Episodic rows do not depend on the summary.

| scenario | age | stored | SQL cand. | guard | relevance | rank | injected | verdict (first failure) |
|---|---|---|---|---|---|---|---|---|
| H50-refusal50 | 50 | True | True | True | True | 1 | True (1 lines) | PASS (-) |
| H500-alliance500 | 500 | True | True | True | True | 1 | True (8 lines) | PASS (-) |
| H1000-seal1000 | 1000 | True | True | True | True | 1 | True (1 lines) | PASS (-) |
| C-refusal50 | 50 | True | True | True | True | 1 | True (2 lines) | PASS (-) |
| C-relationship-change-then-new-state | 200 | True | True | True | True | 1 | True (8 lines) | PASS (-) |
| C-event-and-followup-1000 | 1000 | True | True | True | True | 1 | True (3 lines) | PASS (-) |
| C-time-order | 300 | True | True | True | True | 2 | True (2 lines) | PASS (-) |
| C-invalidated-past-fact | 90 | True | True | True | True | 2 | True (2 lines) | PASS (-) |
| C-unrelated-query | 50 | True | True | True | False | None | False (0 lines) | PASS (-) |
| C-no-evidence-no-invention | 0 | True | True | True | False | None | False (8 lines) | FAIL (irrelevant_memory_intrusion) |
| C-promise-then-cancel-150 | 150 | True | True | True | True | 1 | True (1 lines) | PASS (-) |

Findings, ordered by earliest failing stage:
1. Store: an `explicit_character_claim` whose `fact_text` has no verb in `ATTRIBUTED_CLAIM_TEXT` (e.g. 시인했다, 인정했다, 외쳤다) is dropped as `unattributed_character_claim`. The extraction prompt instructs 밝혔다/주장했다-style attribution, no live run hit this, so it is recorded as FOLLOW-UP, not changed.
2. Store design, not a bug: claims sharing `category:subject:attribute` keep latest-wins (`resolveLatestFactsByLogicalKey`); completed first-hand scene events keep every occurrence (`classifyEpisodicFactTemporalNature` = `historical_event`). The synthetic invalidated-state case (north post superseded by south) therefore injects only the latest; alliance formed/ended and key lost/found, stored as scene events, are both injected in time order.
3. Retrieval gate: any single matched query word opens the relevance gate (`scoreFactForPrompt`: `matchedWords > 0`), and idf weights are normalised to the rarest word present. A query whose only shared word is the recurring character name therefore passes every fact about the character at full weight: up to 8 unrelated lines are injected (C-no-evidence, N-name-plus-unrelated). Targets were never displaced in any scenario (rank 1-2).

## D — one candidate, A/B

Literature checked for principle only: LongMemEval (index/retrieve/read split, time and fact-centric keys), Redis 2026 (raw evidence + extracted fact hybrid — already what verified-quote injection does), Memora (cue anchors), REMem (time-aware event relations), APEX-MEM/Hindsight (temporal updates, observation vs claim — already modelled by CHARACTER_CLAIM authority and historical_event retention). None of it requires a graph DB, vector service, new runner, or new table to apply to finding 3, so none is recommended as a code change here.

Candidate (simulated only, no production code changed): a query word that appears in at least half of the chat's facts cannot open the relevance gate alone.
- Retrieval stage (free, `candidateAb` in `long-horizon-recall-baseline.json`): all 5 answer scenarios keep every target; injected lines on name-only queries drop 8 -> 0 (C-no-evidence, N-name-plus-unrelated); the alliance query drops 8 -> 2. Cost: a name-plus-vague query ("볼프강, 그때 그 일 기억하죠?") drops 8 -> 0, losing the 2 milestone events baseline would surface.
- Reading stage (`noise-reading-ab.jsonl`, same captured Main RP wire, only the episodic block differs, 2 questions x 2 arms x 3 reps, Gemini 3.8 Flash): prompt 17,055/17,045 vs 16,598/16,588 tokens (+457, +2.7%); no arm fabricated a received silver sword (all denied); outputs otherwise differ by sampling only; one NOISE sample used the word "동맹" in a negated aside. Cost $0.1245.
- Result: retrieval noise is real and measurable, reading-stage harm is not demonstrated at n=3, and the candidate has a real downside for vague name-addressed queries. Not adopted. Recorded as FOLLOW-UP (candidate gate with a vague-reference guard, to be re-tested on a real long chat).

## Cost log (new paid calls)

| step | calls | USD | KRW at 1,600/USD |
|---|---|---|---|
| B2 real Main RP recall (Main RP + Luna) | 23 | 0.0587 | 94 |
| D reading A/B | 12 | 0.1245 | 199 |
| total | 35 | 0.1832 | 293 |

Under the 1,000 KRW cap; production keys not used (`RP_QUALITY_PAID_OPENROUTER_KEY`, `CHEAPER_INFERENCE_BENCHMARK_API_KEY` only).
