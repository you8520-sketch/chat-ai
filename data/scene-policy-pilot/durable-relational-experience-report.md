# Durable relational experience — production-path deterministic proof

**Status:** Draft investigation (PR #941 — **do not merge**)  
**Stop lifted provisionally:** `STOP_SCHEMA_DECISION_REQUIRED` suspended pending dual-path proof  
**Classification:** `ROOT_CAUSE_UNCONFIRMED` (dual-path proof complete; schema decision deferred)  
**Architecture decision:** **B** — historical single event representable via existing episodic `explicit_scene_event`; repeated cross-episode pattern has no owner; regen episodic invalidation gap proven  
**Provider HTTP:** 0 | **DB migration:** 0 | **New runtime prompt blocks:** 0

## BEFORE — owner map (current main)

| Fact type | Canonical owner | Preserved today? |
|-----------|-----------------|------------------|
| Prior intimacy / milestone | Rolling summary → lorebook | **Conditional** — only if summarizer retained it |
| Historical role (user top / char bottom) | Rolling summary (prompt asks) + episodic `explicit_scene_event` | **Dual-path** — episodic can backfill summary omission |
| Explicit user preference | Episodic `preference` + `explicit_user_statement` | **Yes** when explicitly stated |
| Single-episode role event | Episodic `explicit_scene_event` (not `relationship_dynamic`) | **Yes** — persist/recall proven (DRE-PATH-4) |
| Repeated role pattern | *No dedicated owner* | **No** |
| Promises / item ownership | Relationship durable ledger | **Yes** (items/promises only) |
| Assistant hallucination of past role | Rolling summary (can canonize) vs episodic (keeps attribution) | **Split** — summary durable; episodic labels as character claim |

## AFTER — owner map (post proof, no schema change)

Same owners; evidence updates:

| Boundary | Before assumption | After proof |
|----------|-------------------|-------------|
| Summary omission = final loss | Assumed | **Disproven** when episodic preserves (DRE-PATH-1) |
| Durable loss | SEXMEM4/REL1 marker-only | **Only when summary AND episodic both omit** (DRE-PATH-2) |
| Primary loss boundary | Rolling summary compression only | **Dual-path** — loss requires both paths to fail |
| Regen invalidation | Assumed symmetric | **Gap** — summary replaced; episodic batch rows **not** cleared on empty re-extract (DRE-PATH-7) |
| False history | Unverified | Summary canonizes assistant prose in LTM; episodic keeps user event + attributed claim (DRE-PATH-6) |

## Production dataflow (fixture chain)

```
SOURCE (turn 3 playable: PRIOR_INTIMACY + ROLE_USER_TOP / ROLE_CHAR_BOTTOM)
  → processRollingSummaryBatch (test seam: summary omits / episodic preserves or omits)
  → chat_turn_summaries + rebuildLorebook (LTM)
  → episodic_memory_facts (seal batch extract)
  → RAW4 exit (resolveProviderRawPoolExchangeCount + rawRecentTurnsToHistory)
  → getEpisodicMemoryForPrompt → [EPISODIC MEMORY - RETRIEVED FACTS] / tracked [3a]
  → buildMemoryContextForChat + buildContext (longTermMemory, episodicMemoryBlock, memoryMeta, shortTermHistory)
  → FINAL Main RP systemPrompt
```

## Fixture evidence (source → summary → episodic → RAW4 → final context)

### DRE-PATH-1 — summary omission + episodic preserve → **PASS**

| Stage | Evidence |
|-------|----------|
| Source | Turn 3 user/assistant lines contain `DRE_PRIOR_INTIMACY_7`, `DRE_ROLE_USER_TOP_9`, `DRE_ROLE_CHAR_BOTTOM_8` |
| Summary | `SUMMARY_OMITS_CONTINUITY` — no role/intimacy markers |
| Episodic | `roleEventFact()` persisted at seal (`explicit_scene_event`) |
| RAW4 | `rawText` excludes role/intimacy markers; `ltmText` excludes them |
| Final | `episodicBlock` + `systemPrompt` contain `[EPISODIC MEMORY - RETRIEVED FACTS]` and `DRE_ROLE_USER_TOP_9`; tracked section label `[3a] Episodic memory retrieved facts` |

**Assertion:** fact survives via episodic dual-path — **not** summary-only loss.

### DRE-PATH-2 — summary omission + episodic omission → **DURABLE LOSS CONDITION PROVEN**

| Stage | Evidence |
|-------|----------|
| Source | Same real turn-3 facts |
| Summary | Omits continuity |
| Episodic | `[]` at seal |
| Final | `episodicFacts.length === 0`, empty episodic block, `systemPrompt` lacks markers |

**Assertion:** durable loss **only** when both owners omit.

### DRE-PATH-4 — role historical event representability → **PASS**

| Check | Result |
|-------|--------|
| `explicit_scene_event` persist | `insertableCount === 1` |
| `relationship_dynamic` / dominance | Blocked (`abstract_psychological_inference`) |
| Recall | `[EPISODIC MEMORY - RETRIEVED FACTS]` contains role markers |

**Assertion:** PAST ROLE ≠ PERMANENT ROLE LOCK — single event OK; trait lock blocked.

### DRE-PATH-6 — false history canonization → **PASS**

| Owner | Behavior |
|-------|----------|
| Rolling summary | LTM contains `DRE_HALLUC_REVERSE` (assistant hallucination canonized) |
| Episodic | Block contains attributed claim (`말했다`) **and** user role event markers |

### DRE-PATH-7 — regen production path → **INVALIDATION GAP PROVEN**

| Stage | Evidence |
|-------|----------|
| Initial seal | Summary + episodic role fact |
| Regen | `refreshRollingSummaryForRegeneratedAssistant` — revised assistant, empty episodic extract |
| Summary | Replaced (`DRE_REGEN_REPLACED`); no `PRIOR_INTIMACY` |
| Episodic | Row count **still 1** — empty re-extract does not delete `summary_seal_batch` rows |
| Final | Stale `DRE_ROLE_USER_TOP_9` still in episodic block after regen |

### DRE-PATH-7b — delete + reconcile → **PASS**

Earlier sealed summary memory preserved after production `reconcileMemoryAfterTurnDelete`.

### SEXMEM4 / REL1 — corrected proof level

| Case | Result |
|------|--------|
| SEXMEM4 | **Not end-to-end loss proof** — generic turns without source facts; marker-only summary absence is insufficient |
| REL1 | Same — insufficient without source fact + dual-path trace |

## Structural gaps (unchanged)

1. `validateSummaryNarrative` / `isRollingSummaryGroundedInDialogue` do not detect continuity-changing fact omission.
2. Rolling summary **prompt** lists intimacy/consent/공수 preservation; validation does not enforce.
3. Relationship memory = items/promises only — no role owner.
4. Regen clears summary batch but **not** episodic batch when re-extract returns empty.

## Decision matrix result

**B.** Historical single event: existing summary + episodic architecture can own it (episodic backfill proven). Repeated cross-episode pattern: no owner. Regen episodic stale row: immediate bugfix candidate (separate from schema). **Do not** open `SCHEMA_DECISION_REQUIRED` yet for single-event representation.

## Regression / validation

- `node --conditions=react-server --import tsx --test src/lib/memory/durableRelationalExperience.test.ts` — 19/19 pass
- `npm run lint` / `npm run typecheck:app` / `npm run build` — run at commit time

## Files changed

- `src/lib/memory/durableRelationalExperience.test.ts` — production-path fixtures DRE-PATH-1/2/4/6/7/7b, SEXMEM/MEMEXP/REL corrections
- `data/scene-policy-pilot/durable-relational-experience-report.md` — this report

## Preserved

RAW4 cost model, summary5 cadence, anti-fixation, explicit preference epistemics, reconvergence PROV unchanged. No merge.
