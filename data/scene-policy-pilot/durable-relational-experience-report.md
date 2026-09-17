# Durable relational experience — memory continuity investigation

**Status:** `STOP_SCHEMA_DECISION_REQUIRED`  
**Classification:** `PROMPT_CONTRACT_ROOT_CAUSE: ROOT_CAUSE_UNCONFIRMED` | `LIVE_MODEL_OUTPUT: UNVERIFIED_NO_PROVIDER_CALL`  
**Provider HTTP:** 0 | **DB migration:** 0 | **V2 / reconvergence:** unchanged

## BEFORE — dataflow (current main)

```
RAW DB messages
  → messagesToTurns / playable turns
  → resolveProviderRawPoolExchangeCount (RAW4 floor + lag expansion)
  → trimProviderHistoryToBudget → shortTermHistory (RAW RECENCY OWNER)
  → rolling summary every 5 turns (Flash background, non-blocking)
  → validateSummaryNarrative + isRollingSummaryGroundedInDialogue
  → chat_turn_summaries → rebuildLorebook → recent_summary (ROLLING SUMMARY / LTM OWNER)
  → episodic extract (max 3, explicit evidence) → episodic_memory_facts (EPISODIC FACT OWNER)
  → relationship meta merge (items/promises only) → formatMemoryMetaForPrompt (RELATIONSHIP DURABLE OWNER — ledger subset)
  → buildMemoryContextForChat + buildContext → Main RP (CONTINUITY CONSUMER)
```

Policy: `summary5_raw4` — `ROLLING_SUMMARY_INTERVAL=5`, `RAW_HISTORY_COMPLETE_EXCHANGES=4`. Summary lag expands RAW **pool** count; trim **floor** stays RAW4.

## OWNER MAP

| Fact type | Canonical owner | Preserved today? |
|-----------|-----------------|------------------|
| Prior intimacy / first-time milestone | Rolling summary → lorebook prose | **Conditional** — only if summarizer retained it in ≤600 chars |
| Historical role (top/bottom, 공수) | Rolling summary prose (prompt asks) | **Unenforced** — no validation for role/consent omission |
| Explicit user preference | Episodic (`preference` + `explicit_user_statement`) or user note/persona | **Yes** when explicitly stated |
| Single-episode role event | Episodic `explicit_scene_event` (not `relationship_dynamic`) | **Possible** — parse allows; dominance/personality inference blocked |
| Repeated role pattern | *No dedicated owner* | **No** — episodic max 3/batch, no pattern schema |
| Promises / item ownership | Relationship durable ledger | **Yes** (items/promises only in Main RP prompt) |
| Honorifics / location / thoughts | memory_meta DB | **Partial** — stored but **not** injected in `[3b] Relationship memo` |
| Unknown past detail | `NO_FALSE_SHARED_MEMORY` + immersive prose callback rules | **Partial** — blocks fabricated shared-history *references*, not personality-based past inference |

## REPRODUCTION (deterministic fixtures)

| Case | Result | Evidence |
|------|--------|----------|
| **SEXMEM1** Prior intimacy after RAW4 exit | **PASS when summary contains fact** | Lorebook retains `DRE_PRIOR_INTIMACY_7`; RAW4 excludes turn 1 |
| **SEXMEM2** Role continuity owner | **GAP** | Relationship memory forbids stage/attachment; no role field |
| **SEXMEM3** Reversed false memory | **POLICY GAP** | `NO_FALSE_SHARED_MEMORY` blocks explicit false shared refs; no rule against inferring past role from current dominance |
| **SEXMEM4** First-time reset | **FAIL CONDITION PROVEN** | Summary without intimacy marker → Main context lacks prior experience |
| **SEXMEM5** Event ≠ preference | **PASS** | `relationship_dynamic` / dominance inference blocked in episodic |
| **SEXMEM6** Repeated pattern | **GAP** | No schema; episodic max 3 facts |
| **SEXMEM7** Explicit preference | **PASS** | Episodic `preference` + `explicit_user_statement` persists |
| **Summary audit** | **GAP** | Prompt preserves 공수/동의; validation accepts summary that omits role markers |
| **REL1–4** Generalized milestones | Same structural gaps | Kiss/intimacy/betrayal depend on summary prose retention |

## ROOT CAUSE

**Primary loss boundary:** Rolling summary LLM compression (≤600 chars / batch), with **prompt-only** preservation of continuity-changing facts (intimacy existence, role, consent). Runtime validation does **not** detect omission of role/consent/intimacy facts.

**Secondary gaps:**

1. No canonical owner for **durable relational experience** except prose in rolling summary.
2. Relationship memory is **ledger-only** (items/promises) — not role/history.
3. Episodic blocks **inference** (good for preference epistemics) but cannot represent repeated patterns across batches without redundant prose in LTM.
4. False-memory policy prevents *claiming* shared history without evidence, but does not prevent *improvising* unknown past details from current character traits.

**Not root cause:** RAW4 immediate loss (coverage logic + lorebook exclude overlap handles RAW4 exit when summary is good).

## AFTER (minimal direction — not implemented)

Within change budget, options **without** new schema:

1. **Rolling summary owner:** Add deterministic post-seal **continuity sentinel** check when source batch contains explicit user-declared durable facts (not regex role canonization) — requires careful design; may hit stop condition if budget changes needed.
2. **Episodic owner:** Already correct for explicit preferences; continue blocking single-event → permanent preference.
3. **Main RP consumer:** Strengthen unknown-past epistemics in existing `NO_FALSE_SHARED_MEMORY` / immersive prose (prompt-only; no new block).

**Requires schema / follow-up (STOP):**

- Repeated pattern state across episodes
- Structured durable relational experience row
- NSFW-specific permanent preference store

## PRESERVED

RAW4 cost model, summary5 cadence, anti-fixation (IMMERSIVE PROSE), explicit preference epistemics, regen batch replace (MEMEXP9), reconvergence PROV1–10 unchanged.

## REGRESSION RISKS (if fixing)

Memory bloat, false permanent preference, old-event obsession, role lock-in.

## PROOF

- `src/lib/memory/durableRelationalExperience.test.ts` — SEXMEM1–7, MEMEXP1–10, REL1–4, summary audit
- `src/lib/reconvergenceProvenance.test.ts` — MEMEXP10 / PROV unchanged
- Existing: `memory-continuity-reset-audit`, `memory-ltm-raw-integration`, `episodicMemoryFacts`

## STOP CONDITIONS MET

- Durable relational role/history lacks enforced owner beyond prose summary
- Fixing reliably likely needs validation design and/or structured follow-up
- No provider call performed; no DB migration in this PR
