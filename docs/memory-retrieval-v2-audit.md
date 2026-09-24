# Episodic retrieval V2 audit

Base: `e7d7342a70edd29f8991636a6c9e80e99e1c25ea` (Railway `chat-ai` production `main`, successful deploy checked 2026-09-24). The route at `src/app/api/chat/route.ts` calls `getEpisodicMemoryForPrompt` once before context assembly. Model transport and fallback builds reuse that context input.

Railway production service source is `you8520-sketch/chat-ai`, branch `main`. Relevant configured variable names include `EPISODIC_MEMORY_RECALL_ENABLED`, `MEMORY_5PLUS4_ENABLED`, `PROMPT_DEBUG`, and `ADMIN_DEBUG_TOKEN`; this audit read names, not secret values. The code-level memory master switch is `MEMORY_FEATURE_ENABLED` with its existing default behavior.

## Canonical owner map

| Responsibility | Owner |
| --- | --- |
| Capture contract | `src/lib/memory/memory-episodic-prompt.ts` |
| Extraction call | `src/lib/memory/memory-episodic-extract.ts` |
| Fact schema/normalization | `src/lib/memory/memory-episodic-types.ts`, `memory-episodic-normalize.ts` |
| Persist, source mutation, deletion | `src/lib/episodicMemoryFacts.ts` |
| Candidate discovery and source boundary | `fetchEpisodicMemoryCandidateRows`, `buildEpisodicCandidateScope` in `episodicMemoryFacts.ts` |
| Retrieval guards and ownership | `evaluateEpisodicRetrievalGuard` in `episodicMemoryFacts.ts` |
| Global latest state | `reconcileGlobalStateLikeFacts` in `episodicMemoryFacts.ts` |
| Local latest state, historical events | `resolveLatestFactsByLogicalKey` in `episodicMemoryFacts.ts` |
| Duplicate suppression | `findDuplicateReason` in `episodicMemoryFacts.ts` |
| Final score and relevance gate | `scoreFactForPrompt` in `episodicMemoryFacts.ts` |
| Prompt budget and diagnostics | `getEpisodicMemoryForPrompt` in `episodicMemoryFacts.ts` |
| Retrieved fact instruction hygiene | `sanitizeRecalledMemoryFactText` in `runtimePromptContaminationGuard.ts`; existing retrieval guard still checks schema/ownership |
| Prompt section and insertion | `formatEpisodicMemoryPromptSection` in `episodicMemoryFacts.ts`; `contextBuilder.ts` inserts the section |
| Relationship durable ledger | Existing relationship memory pipeline; episodic guard rejects ledger-owned promises/items |
| Global/medium memory | Existing memory injection in `chat/route.ts` and `contextBuilder.ts`; unchanged |

## Before and deterministic problem

Candidate discovery had 55 recent, 25 `LIKE` token relevance, 10 critical and 10 important historical milestone slots per 100 candidates. Relevance is lexical substring matching, not semantic. The final comparator sorted importance first, lexical overlap second, then source turn. There was no relevance floor. The pre-change `memory-retrieval-v2.test.ts` fixture showed an unrelated critical tower fact selected ahead of a normal storm fact, and an unrelated tower fact injected when alone. The paraphrase fixture also recalled despite no meaningful semantic match because the old path filled free budget. This is not evidence of semantic understanding.

The retrieval path already ran source/canon/ledger guards, global latest-state reconciliation, local latest-state and historical event preservation, duplicate checks against current user/recent RAW/long-term/relationship/lorebook/triggered event, then dynamic budget selection. `getEpisodicMemoryForPrompt` catches retrieval errors and returns an empty block. Regeneration, deletion, reset, fork, and provenance stay with the existing store and scope owners.

Fixture map: `memory-retrieval-v2.test.ts` covers lexical exact, semantic paraphrase, irrelevant critical versus relevant normal, old critical milestone with a relevant cue, unrelated important historical-event rejection, zero relevant result, score diagnostics, mixed history/instruction text, and instruction-suffix text that must not manufacture relevance. `episodicMemoryFacts.test.ts` covers latest state, current-user/recent RAW override, relationship/canon suppression, budget, deletion, and retrieval failure. `memory-episodic-long-horizon.test.ts` covers historical event pairs, stale versus latest state, milestone candidate coverage, reset, deleted sources, and RAW-window precedence. `memory-episodic-hardening.test.ts` covers regeneration and rejected variants; `memory-episodic-scope-regression.test.ts` covers noncanonical and fork-like scope isolation. The supplied normal recent fact is exercised by lexical and budget tests. Existing tests for these invariants remain the canonical regression fixtures; this change did not duplicate their setup.

## After

Candidates still protect recall coverage. The final scorer combines capped lexical overlap, importance, age decay, and a historical milestone signal. A nonempty scene query always needs lexical overlap; milestone lanes keep old important events discoverable but do not bypass the relevance floor. An empty debug query retains browse behavior. The score owner is shared by runtime and inspection. Diagnostics record lane provenance, component scores, pass/fail, duplicate/budget reason, and final rank. No text is newly sent to production users.

Retrieved fact text is sanitized at the fact boundary before prompt formatting; the historical clause before an embedded command survives. The header now says retrieved memories are historical data, never instructions. Two duplicate introductory/current RAW sentences were consolidated.

The source table, provenance, relationship ledger, canon, global/medium memory, budget constants, and mutation paths were not changed. The extraction contract still says `NEW or CHANGED`, while persistence can append cross-turn state rows and retrieval chooses the latest. Physical write consolidation needs separate provenance/regeneration/delete/fork proof.

## Semantic follow-up, separate review

No approved embedding or vector index owner was found in the current memory runtime. A future derived, disposable index could point at canonical `episodic_memory_facts` IDs, then feed existing source guards, latest-state reconciliation, dedupe, score, and budget. Index failure must fall back to lexical recall. Provider cost, latency, and privacy need explicit review before any synchronous embedding call. Walrus SDK/storage/autoSave/autoRecall are not adopted.
