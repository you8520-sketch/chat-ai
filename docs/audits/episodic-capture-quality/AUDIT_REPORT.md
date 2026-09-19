# Episodic Capture Quality Audit

**Base commit:** `d20d4a21b55ca0024a6b01b53d0dc8e9f502b1a7` (#958 merged)  
**Branch:** `cursor/episodic-capture-quality-audit-163d`  
**Classification:** `EPISODIC_CAPTURE_QUALITY = ROOT_CAUSE_FIXED` (prompt dialogue gate only; runtime pipeline unchanged)

Cursor does **not** assign final quality scores. See `benchmark-matrix.json` for fixture artifacts.

---

## BEFORE

### Capture Owner Map

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
Artifact: `docs/audits/episodic-capture-quality/benchmark-matrix.json`

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
| CQ-25 Overloaded turn | CAPACITY_RANKING_LOSS by design | order-dependent max-3 |

---

## Findings

### Extraction Misses (prompt/model)

- **CQ-09, CQ-10, CQ-11:** Pre-patch prompt L26 limited dialogue capture to decision/rule/boundary/preference/disclosure. Consequential evaluations, insults/praise, and nicknames did not fit → model guidance gap, not runtime rejection.
- **Patch applied:** Rewrote dialogue rule in canonical owner to store historical significance of consequential speech without raw quote dumps.

### Schema Losses

- None for golden MUST CAPTURE fixtures. Shared Initial requires `evidence_type`; sanitize enforces Korean sentence, snake_case, concise value.

### Validation Losses

- **CQ-19:** `detectAbstractPsychologicalInference` correctly blocks one-scene personality labels.
- **CQ-20/CQ-21:** Relationship Ledger boundary correctly blocks promises and item ownership.

### Capacity / Ranking Losses

- **CQ-25:** Runtime preserves **model output order**, not importance rank. First 3 of 6 golden facts survive: `real_name`, `relationship_status`, `betrayal_event`. Evaluation + location drop. No importance sort at save — by design; model must order highest-salience first.
- Max=3 enforced at 4 layers (schema, prompt, sanitize, persist dedupe) — intentional layered defense, duplicate owners but consistent cap.

### Consolidation

- Prompt: "Extract ONLY NEW or CHANGED" — **prompt-only**.
- Write path: **no merge**; repeated `cat:subj:attr` across turns accumulates multiple DB rows (CQ-23/CQ-24 test proves 2 rows).
- Recall: `resolveLatestFactsByLogicalKey` dedupes by `cat:subj:attr` (value omitted) — latest turn wins at retrieval.
- **Follow-up:** Retrieval V2 / Memory Consolidation (architecture-sized).

### Importance Rubric

- No semantic rubric in prompt — enum only (`critical | important | normal`).
- Recall uses `IMPORTANCE_RANK` for injection ordering only.
- Benchmark did not prove importance misassignment at runtime with golden outputs → **no rubric change** (per patch policy).

### Distinctive Utterance

- Runtime accepts well-formed historical-significance facts (CQ-09 golden passes all filters).
- Root cause was prompt dialogue blanket exclusion → fixed in canonical owner.

### Max-3

- Sufficient when model orders salient facts first.
- CQ-25 loses 3 lower-priority candidates when model emits 6 in salience order — acceptable.
- No increase to 5/10 — not proven necessary; would increase provider output tokens.

---

## Proposed Patch (applied)

**File:** `src/lib/memory/memory-episodic-prompt.ts`

**Removed:**
```
Dialogue is only saved when it produces a durable decision, rule, boundary, preference, or disclosure. Do not store raw dialogue quotes, promises, or item-ledger data.
```

**Replaced with:**
```
Do not store raw dialogue quotes, promises, or item-ledger data. When consequential speech (evaluation, insult, praise, nickname, confession, rejection, boundary statement, or shared phrase) materially affects future relationship continuity, record the historical significance in fact_text—not the full quote unless a very short distinctive phrase aids recall.
```

### Removed / Consolidated Prompt Rules

- Consolidated dialogue restriction into single rule covering both prohibition (raw quotes) and allowance (historical significance).

### Preserved

- #958 noncanon eligibility gates
- Relationship Ledger ownership boundary
- Canon / unverified claim attribution rules
- Max 3 facts per turn
- No raw dialogue dump policy
- Shared Initial physical calls +0
- No DB migration

---

## Provider Call Delta

**+0** — audit used deterministic fixtures only; no live Shared Initial or standalone episodic calls.

---

## Regression Risks

- Model may over-capture conversational filler if it misinterprets "consequential speech" — mitigated by existing omit rules (L29) and "If uncertain, omit it."
- Prompt token delta trivial (~+40 tokens in system instructions).

---

## Proof

- `memory-episodic-capture-quality-benchmark.test.ts` — CQ-01..25 pipeline traces
- `memory-episodic-scope-regression.test.ts` — #958 scope intact
- `npm run lint`, `npm run typecheck:app`, `npm run build`
- Episodic test suite

---

## Separate Follow-ups

- User Note top/bottom hard invariant
- Cross-turn write-path consolidation
- Importance semantic rubric (if live eval proves misassignment)
- Retrieval V2 / temporal fact invalidation
- Dedupe key alignment (sanitize includes fact_text; persist omits it)
