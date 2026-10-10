# Monthly RP Memory Quality — Phase 1

Status: **live-path A–I fixtures + one retrieve-owner fix. No provider POST. No 10,000-char raise. No monthly paid-call change. Cursor did not score memory or style.**

EXACT MAIN SHA at branch start: `b864d7eb454a0081dc2a8d74f5e732563bdd81e8` (also the reported Railway PRECALL SUCCESS SHA). This PR does not repeat PRECALL.

Tracking: #1486. OpenScale #1490 is out of scope.

## BEFORE

The monthly GitHub Action (`.github/workflows/validate-rp-active-model-quality.yml`, cron `17 4 4 * *`) still runs `RP_ACTIVE_MODEL_QUALITY_SOURCE=HISTORICAL_ONLY` against 2026-08-25 character id=10 fixtures (`memory_current_state_priority`, `memory_false_shared_event`). That path can issue bounded paid generation. It is not the current 라이크 18 / 렌 5-turn + episodic + Global Current Memory path.

## PROBLEM

Homepage memory quality cannot be judged from HISTORICAL_ONLY monthly evidence. New chats have `MEMORY_5PLUS4` policy `summary5_raw4`, episodic recall, and optional semantic search enabled, but storage → retrieval → injection quality was not covered by a live-identity deterministic suite.

## ROOT CAUSE

**C (days vs months) was a live retrieve bug, not a persist or prompt bug.**

Both dated `scene_event` rows persist. `resolveLatestFactsByLogicalKey` keeps distinct historical identities. The month-old row then fails `scoreFactForPrompt`'s relevance floor:

`tokenizeForSimpleBoost("이틀 전과 두 달 전 일을 구분해줘")` kept `이틀` / `전과` / `일을` / `구분해줘` and dropped `두` / `달` / `전` (length &lt; 2). `lexicalRelevance` for the T40 fact was 0, so `passes` was false and T40 never injected. T8 survived only because `이틀` is already a two-character compound.

Owner: `tokenizeForSimpleBoost` / `isKeepableRetrievalToken` in `src/lib/episodicMemoryFacts.ts`. Not a new prompt. Not a 10,000-char raise.

A, B (after ledger-correct rooftop-smoke fixture), D–I already passed on the live retrieve/inject path. B's first fail was a fixture using “약속했다” (relationship-ledger owned) — not a retrieve bug.

## OWNER MAP

| Responsibility | Canonical owner |
| --- | --- |
| 5-turn seal prompt + LLM | `buildRollingSummarySystemPrompt` / `summarizeTurnBatch` in `src/lib/memory/memory-rolling-summary.ts` |
| Policy | `MEMORY_POLICY_ID=summary5_raw4`, `ROLLING_SUMMARY_INTERVAL=5`, `RAW_HISTORY_COMPLETE_EXCHANGES=4` in `memory-constants.ts` |
| When seal runs | Next `POST /api/chat` catch-up / barrier; post-turn does not seal (`memory-manager.scheduleMemoryUpdate`) |
| Summary model | `callBackgroundMemory` → `BACKGROUND_OPENROUTER_MODEL` (default `gpt-6-luna`) |
| Summary storage | `chat_turn_summaries` + `chat_memories.recent_summary` via `memory-summary-persist.ts` |
| Last raw turns | RAW4 (+ RAW5 only at deferred boundary). There is no “last 6 turns” summary policy. 50-turn-ago text lives in sealed 5-turn rows + Global Current Memory + optional medium-term (15 blocks) |
| Episodic write | Shared Initial `extracted_facts` → `reconcileSharedEpisodicFactsForTurn`. Seal-batch extractor exists but has no production importer |
| Episodic retrieve / inject | `getEpisodicMemoryForPrompt` → `contextBuilder` `[3a]` |
| LTM 10,000 | `MEMORY_CAPACITY_FIXED` in `memory-capacity-shared.ts`. Storage + injection rebuild. Over budget: LLM compact, then prefer-recent mechanical trim |
| Relationship ledger | `chats.memory_meta` → `[3b]`. Promises/items. Honorifics stored, not injected |
| Event time vs created_at | Recall ranks by `source_turn`. `created_at` is insert time only. Narrative time lives in `fact_text` |
| Isolation | `chat_id` (+ optional character/user) and memory epoch / reset boundary |
| Monthly schedule | `validate-rp-active-model-quality.yml` — HISTORICAL_ONLY live_evidence |

## 5-turn summary source (live)

Owner: `ROLLING_SUMMARY_SYSTEM_PROMPT` (`buildRollingSummarySystemPrompt(5)`).

Preserved rules already in that prompt: ordered events, explicit in-story time only, no guessed user inner state, actor/direction when it changes meaning, emotion/relation change, 공수 position when present, no eval-only “write longer / write psychology” lines.

Persist gate `validateSummaryNarrative` checks empty / OOC / instruction-echo / min length. It does **not** score actor or calendar retention. GPT reviews actual summary text after an authorized paid run.

## Memory create → move → inject

1. Playable turns stay RAW until a 5-turn batch is seal-eligible.
2. Background Luna (`callBackgroundMemory`) writes one `chat_turn_summaries` row and updates `summarized_turn_count`.
3. Global Current Memory rebuilds from sealed rows into `recent_summary` (10,000-char lorebook budget). Overflow goes to `archive_summary` (+3,000) or compact/trim.
4. Shared Initial may write `episodic_memory_facts` per turn. Retrieval uses lexical V2; semantic is additive and env-gated.
5. Next main RP turn: RAW + `[3] Current Memory` + optional medium-term + `[3a]` episodic + `[3b]` relationship.

## AFTER

`tokenizeForSimpleBoost` now keeps Korean calendar-unit unigrams `달` / `년` / `주` so day-vs-month contrast queries can hit both stored facts. `전` / `후` / `일` stay excluded (over-match).

Added `src/lib/memory/monthlyRpMemoryQualityPhase1.test.ts` against the live owners (라이크 18 / 렌):

- A 6-turn-old event recall (production minAge)
- B 50-turn-old event among filler
- C day-old vs month-old wording kept distinct
- D past event vs current emotion vs invented future
- E explicit 공수 direction, no gender inference
- F completed emotion-change vs momentary mood
- G assistant-only claim stays a claim
- H live 5-turn prompt contract (no second prompt)
- I retrieved block reaches `contextBuilder` section `episodic-memory-retrieved-facts`
- 10,000-char cap remains 10,000

No production prompt edit. No monthly workflow edit. No paid POST. No 10k raise.

## REMOVED

None. Leftovers were classified, not deleted.

## Leftovers

| Item | Class | Why |
| --- | --- | --- |
| Live 5-turn prompt / persist / inject owners | KEEP | Production path |
| Shared Initial episodic extract | KEEP | Live writer |
| `extractAndPersistEpisodicFactsForSealedBatch` | FOLLOW-UP | Implemented, no production importer |
| Honorifics in `memory_meta` not injected | FOLLOW-UP | Stored, omitted from `[3b]` |
| `generateRollingSummary` / `ai.ts` `summarizeTurnBatch` | KEEP (dead for live seal) | Tests still import; do not delete without reader proof |
| Monthly HISTORICAL_ONLY live_evidence | KEEP this phase | Paid-call retarget is an operator decision |
| Event-time ranking (vs `source_turn`) | FOLLOW-UP | Would be a new temporal index, not a one-line fix |
| 12K / 15K LTM | FOLLOW-UP | Design only; no raise |

## 10,000 vs 12K / 15K (design only)

| Budget | What we know | Token / latency / risk |
| --- | --- | --- |
| 10,000 (live) | `MEMORY_CAPACITY_FIXED`; compact then prefer-recent trim | Current production. Prefer-recent can drop older dated blocks when over budget |
| 12,000 | +20% lorebook chars | Roughly +0.5–1k tokens on DeepSeek-class packing if the extra text is unique. Helps keep one extra sealed block. No evidence it beats better retrieval |
| 15,000 | +50% | Higher input cost every turn that injects Global Memory. Risk: older filler stays, RAW/style sections compete. Needs equal-budget A/B on the live assembler |

Do not raise the cap in this PR. Next measurement, if approved, should compare recall of dated events (C) and 50-turn milestones (B) at 10K vs 12K vs 15K with the same provider budget and POST authorization.

## Monthly paid job — next stage only

Keep cron and call count this month. Do not label HISTORICAL_ONLY scores as current-site memory quality. A later stage may consume this live fixture file, or pause HISTORICAL_ONLY, only after budget/credential/admin-alert owners are approved. Auto research Draft PR and admin-account notice are not in this PR.

## Research (apply later, no new DB)

- Graphiti: event time vs ingest time — map onto `fact_text` + `source_turn`, not a graph store
- LongMemEval / V2: abstain when time is unknown — already in the 5-turn prompt (“불명확하면 추측하지 않는다”)
- Memory-Driven RP (ACL 2026): Anchoring/Selecting/Bounding/Enacting — already split across canon, retrieval guards, 10k bound, RAW
- Dynamic Persona Coherence: fixed identity vs mid/short affect — `clearly_temporary` vs durable facts

## PRESERVED

Live memory write/inject, user isolation, model final-wire, summary cost policy, monthly schedule, 10,000-char cap, production prompts. Provider POST 0. Production DB write 0.

## REGRESSION RISKS

Keeping `달`/`년`/`주` can add those unigrams to the first-5 relevance lane when a user mentions a month/year/week. Unrelated facts that merely contain those syllables can now pass the relevance floor. `전`/`일` were left out for that reason. Existing zero-overlap cases (`바다 항해` vs tower color) stay closed.

A later event-time ranker could starve recent RAW-adjacent facts if added carelessly. Do not raise 10k from this file.

## PROOF

`src/lib/memory/monthlyRpMemoryQualityPhase1.test.ts` — live-path A–I plus 10k cap. No Cursor quality score.

## SYSTEM DELTA

One retrieve-tokenizer keep-list + one deterministic live-path suite + this report. No second memory stack. No OpenScale / #1490 change. No monthly paid-job retarget.
