# Episodic Capture Quality Audit

**Base commit:** `d20d4a21b55ca0024a6b01b53d0dc8e9f502b1a7` (#958 merged)  
**Branch:** `cursor/episodic-capture-quality-audit-163d`

## Classification

| Subproblem | Classification |
|---|---|
| **Overall** | `EPISODIC_CAPTURE_QUALITY = ROOT_CAUSE_UNCONFIRMED` |
| Consequential utterance prompt gate (CQ-09/10/11) | `CONSEQUENTIAL_UTTERANCE_PROMPT_GATE = ROOT_CAUSE_FIXED` |
| Runtime pipeline for golden facts | `EPISODIC_RUNTIME_PIPELINE_FOR_GOLDEN_FACTS = NO_MATERIAL_DEFECT_FOUND` |
| Real model salience / top-3 selection | `REAL_MODEL_SALIENCE_SELECTION = ROOT_CAUSE_UNCONFIRMED` |

Cursor does **not** assign final quality scores. Human-readable evidence: this report + deterministic fixtures in `memory-episodic-capture-quality-benchmark.test.ts`.

---

## Capture Owner Map

| Responsibility | Canonical Owner | Location |
|---|---|---|
| EPISODIC CAPTURE POLICY | `EPISODIC_FACTS_EXTRACT_INSTRUCTIONS` | `src/lib/memory/memory-episodic-prompt.ts` L6–39 |
| EPISODIC IMPORTANCE | Same prompt (enum) + recall rank | Prompt L13; `IMPORTANCE_RANK` in `episodicMemoryFacts.ts` L107–111 |
| EPISODIC MAX FACT | Shared schema constant + layered caps | `EPISODIC_FACTS_MAX_PER_SHARED_TURN=3` in `memory-episodic-shared.ts`; prompt L38; `sanitize` L117; `dedupeFactsWithinResponse` L678 |
| EPISODIC SCHEMA | Shared Initial JSON schema | `buildSharedEpisodicSectionJsonSchema()` in `memory-episodic-shared.ts` |
| EPISODIC VALIDATION | Normalize/sanitize contract | `sanitizeEpisodicExtractedFacts()` in `memory-episodic-normalize.ts` |
| EPISODIC SAVE FILTERS | Persist-time safety chain | `filterUnsafeEpisodicFactsForSave()` in `episodicMemoryFacts.ts` |
| EPISODIC DEDUPE (within-response) | Normalize + persist | sanitize key `cat:subj:attr:value:factText`; persist key `cat:subj:attr:value` |
| CROSS-TURN CONSOLIDATION | **Retrieval only** | `resolveLatestFactsByLogicalKey()` — key `cat:subj:attr`, latest turn wins |
| RELATIONSHIP LEDGER BOUNDARY | Ledger detector | `detectRelationshipLedgerOwnedFact()` |
| CANON BOUNDARY | Prompt + unverified canonicalization + #958 eligibility | `detectUnverifiedCanonicalization()`; `memory-episodic-eligibility.ts` |
| SOURCE PROVENANCE | DB + metadata | `source_user_message_id`, `metadata.memory_evidence_type`, `resolveExplicitUserStatementProvenance()` |

Shared Initial wrapper (`buildSharedInitialEpisodicSectionInstructions`) reuses the same body — no duplicate salience owner.

---

## Benchmark Matrix CQ-01..25

Deterministic fixtures: `src/lib/memory/memory-episodic-capture-quality-benchmark.test.ts`  
Matrix is computed in test memory only — **tests must not write tracked files**.

| ID | Runtime (golden output) | Prompt-level risk |
|---|---|---|
| CQ-01 Identity | NONE | — |
| CQ-02 Relationship milestone | NONE | — |
| CQ-03 Betrayal | NONE | — |
| CQ-04 Reconciliation | NONE | — |
| CQ-05 Secret disclosure | NONE | — |
| CQ-06 Durable preference | NONE | — |
| CQ-07 Role preference | NONE | — |
| CQ-08 Boundary | NONE | — |
| CQ-09 Consequential utterance | NONE (runtime accepts golden) | **EXTRACTION_MISS** (pre-patch dialogue gate) |
| CQ-10 Praise/insult | NONE | **EXTRACTION_MISS** (pre-patch) |
| CQ-11 Nickname | NONE | **EXTRACTION_MISS** (pre-patch) |
| CQ-12 Location | NONE | — |
| CQ-13 Quest | NONE | — |
| CQ-14 Character claim | NONE | — |
| CQ-15 Greeting | EXPECTED_OMIT | — |
| CQ-16 Temp emotion | EXPECTED_OMIT | — |
| CQ-17 Mundane action | EXPECTED_OMIT | — |
| CQ-18 Transient combat | EXPECTED_OMIT | — |
| CQ-19 Psych inference | VALIDATION_LOSS | — |
| CQ-20 Promise | VALIDATION_LOSS (ledger) | — |
| CQ-21 Item transfer | VALIDATION_LOSS (ledger) | — |
| CQ-22 Canon repeat | EXPECTED_OMIT | — |
| CQ-23 Repeated fact | NONE | CONSOLIDATION follow-up |
| CQ-24 Changed fact | NONE | CONSOLIDATION follow-up |
| CQ-25 Overloaded turn | CAPACITY_RANKING_LOSS (handcrafted order) | — |

---

## Findings

### Extraction Misses (prompt/model)

- **CQ-09, CQ-10, CQ-11:** Pre-patch prompt L26 limited dialogue capture to decision/rule/boundary/preference/disclosure. Consequential evaluations, insults/praise, and nicknames did not fit → model guidance gap, not runtime rejection.
- **Patch applied:** Rewrote dialogue rule in canonical owner to store historical significance of consequential speech without raw quote dumps.

### Schema / Validation

- Golden MUST CAPTURE fixtures pass sanitize and save filters.
- CQ-19 psych inference and CQ-20/21 ledger ownership correctly blocked at validation.

### CQ-25 — Evidence Boundary

**Proves (deterministic, handcrafted golden order):**

- `MAX3_RUNTIME_CAP = VERIFIED` — cap enforced at persist summary
- `MODEL_OUTPUT_ORDER_PRESERVED = VERIFIED` — first 3 of 6 golden facts survive in fixture order

**Does NOT prove:**

- `REAL_MODEL_SALIENCE_ORDERING` — no live extractor eval
- `REAL_MODEL_TOP3_SELECTION_QUALITY` — golden facts were pre-sorted by design

**Conclusion:** max=3 runtime behavior works as designed. Current deterministic evidence does **not** prove real extractor salience ordering. No basis to change max=3; live extractor quality remains a future controlled-eval item.

### Consolidation

- Prompt "NEW or CHANGED" is **prompt-only**; write path accumulates duplicates; recall latest-wins by `cat:subj:attr`.
- **Follow-up:** Retrieval V2 / Memory Consolidation.

### Importance Rubric

- Enum only in prompt; no semantic rubric. No proven misassignment with golden outputs → no change.

---

## Patch Applied (preserved)

**File:** `src/lib/memory/memory-episodic-prompt.ts` — single rule replacement in `EPISODIC_FACTS_EXTRACT_INSTRUCTIONS`.

**Removed:**
```
Dialogue is only saved when it produces a durable decision, rule, boundary, preference, or disclosure. Do not store raw dialogue quotes, promises, or item-ledger data.
```

**Replaced with:**
```
Do not store raw dialogue quotes, promises, or item-ledger data. When consequential speech (evaluation, insult, praise, nickname, confession, rejection, boundary statement, or shared phrase) materially affects future relationship continuity, record the historical significance in fact_text—not the full quote unless a very short distinctive phrase aids recall.
```

No new prompt sections or exception sentences added.

---

## Artifact Writer / Reader Proof

| Path | Writer | Runtime/tooling reader |
|---|---|---|
| `benchmark-matrix.json` | ~~test `writeFileSync`~~ **removed** | **None** — grep shows references only in deleted test + old report text |
| `AUDIT_REPORT.md` | human audit doc | none |
| `memory-episodic-capture-quality-benchmark.test.ts` | fixtures + in-memory matrix | test-only |

**Principle:** test execution must not modify tracked source/artifact files.

---

## Provider Call Delta

**+0** — deterministic fixtures only.

---

## Separate Follow-ups

- Controlled live extractor salience eval
- Importance semantic rubric
- Cross-turn write-path consolidation
- User Note hard invariant
- Retrieval V2
