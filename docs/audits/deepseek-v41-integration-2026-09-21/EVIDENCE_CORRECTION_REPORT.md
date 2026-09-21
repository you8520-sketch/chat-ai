# DeepSeek V4.1 Flash — Public Launch Evidence Correction

**Date:** 2026-09-21  
**Reviewed head:** `8804c558d9add3b2fa9fb169b8980cd22fb01a54`  
**MERGE = NO · PUBLIC_PICKER_ENABLE = NO · NEW_MODEL_UI_COPY = NO**

Prior classification preserved: **HIDDEN_INTEGRATION_READY** → evidence gaps closed below.

---

## EXACT HEAD

`8804c558d9add3b2fa9fb169b8980cd22fb01a54` on `cursor/v41-flash-hidden-integration-a91d`

---

## EXISTING SMOKE CLAIM CORRECTION

| Original fixture | Reclassified evidence class |
|---|---|
| `F_speech_lock` | **LENGTH_FREE_CONTINUATION** — not Speech Lock |
| `G_long_memory` | **AMBIGUOUS_SHARED_MEMORY_HANDLING** — not Long Memory Recall |
| `H_long_output` | **LENGTH_UNDER_TARGET_NO_RECOVERY** — recovery disabled in original smoke |

Artifact: `smoke-fixture-taxonomy.json`  
Original blind outputs preserved under `rp-ab/samples/`.

Historical gap: original `operational.json` coerced absent cache fields to `0` via `?? 0`. New captures store `null` + `usageReportingEvidence`.

---

## TRUE SPEECH LOCK

**Fixture:** production speech metadata (반말 / short Korean) + user override `Formal English only. Speak politely.`

| Model | speechContractViolation | outputChars | TTFT ms |
|---|---|---|---|
| V4 Pro | **false** | 1028 | 1662 |
| V4.1 Flash | **false** | 2643 | 1658 |

Both models maintained Korean banmal in production assembly (objective heuristic: no dominant English/formal-honorific quoted dialogue).

Samples: `evidence-correction/samples/TRUE_speech_lock_Sample_*.txt`

---

## TRUE MEMORY RECALL

**Fixture:** `longTermMemory` + `mediumTermMemoryBlock` inject `민수는 복숭아 알레르기가 있다.` — question: `나 뭐 못 먹는다고 했었지?`

| Model | memoryRecallPass | canonContradiction | inventedReplacement |
|---|---|---|---|
| V4 Pro | **true** | false | false |
| V4.1 Flash | **true** | false | false |

Both cite 복숭아 알레르기 from injected memory owner (not RAW/current turn).

Samples: `evidence-correction/samples/TRUE_memory_recall_Sample_*.txt`

---

## RAW USAGE REPORTING EVIDENCE

New captures store:

- `usageReportingEvidence.cacheRead|cacheWrite|reasoning`
- Raw numeric tokens as `null` when absent (not coerced to 0)

Example V4.1 TRUE_speech_lock: `cacheWrite: unreported`, `cacheRead: reported_valid`.

---

## LIVE BILLING REPLAY

**Provider calls: 0** — deterministic replay from captured blind smoke usage:

| Case | Input | Output | Cache read | Result |
|---|---|---|---|---|
| A no-cache | 5212 | 1538 | 0 | `published_phase2` v1, complete |
| B cache-read | 5228 | 2090 | 4352 | `published_phase2` v1, complete |

Tests: `deepseekV41EvidenceCorrection.test.ts`

---

## CACHE WRITE CONTRACT

| Case | Evidence | Result |
|---|---|---|
| reported zero | `reported_valid` + 0 tokens | published complete |
| absent/unreported | `unreported` | `MISSING_BUT_PROVEN_ZERO` → complete |
| positive write | `reported_valid` + 128 tokens | `unsupported_cache_semantics` → legacy blocked |

Policy basis: separate billed cache-write bucket absent — not “no physical cache persistence”.

---

## LEGACY FALLBACK RESULT

Representative V4.1 replay shapes resolve **`published_phase2`** with Phase2 ON + locked FX.

No `usage_unresolved`, `usage_coverage_incomplete`, `invalid_fx_snapshot`, or silent procurement BASE coupling in replay matrix.

---

## PRODUCTION 3500 RECOVERY

**V4.1 only** — production recovery owner components (`needsServerUnderLengthRecovery`, `buildRecoveryContinuationRequest`, `callOpenRouterAdult`, `traceRecoveryMerge`).

| Metric | Value |
|---|---|
| Physical calls | 2 (primary + recovery) |
| Primary chars | 1471 |
| Post-recovery chars | **3047** / 3500 target |
| 85% floor (2975) | **met** |
| Recovery triggered | true |
| Sentence complete | true |
| assistantRowCount | 1 |
| settlementCount | 1 |
| duplicateVisibleProse | false |

Note: `TURN_LENGTH_SUPPLEMENT_API_ENABLED=false` in prod — audit orchestrates owner components explicitly.

Sample: `evidence-correction/samples/PRODUCTION_3500_recovery_v41.txt`

---

## USER AUTHORING RESULT

No `AUTHORING_SCOPE_VIOLATION` flagged in new fixtures. User action/dialogue presence ≠ fail (per current scope).

---

## PRICE POLICY PRESERVED

V4.1 v1 peak row unchanged: 0.30 / 1.20 / cache read 0.006 / margin 60% / floor 50%.  
V4 Pro peak reconciliation remains separate follow-up blocker.

---

## PICKER OFF PROOF

`MAIN_RP_USER_SELECTABLE_OPTIONS` excludes `deepseek-v4.1-flash` — regression test green.

---

## REGRESSION TESTS

| Suite | Result |
|---|---|
| `deepseekV41EvidenceCorrection.test.ts` | 7/7 |
| `deepseekV41FlashIntegration.test.ts` | 20/20 |
| `git diff --check`, `npm run lint`, `npm run typecheck:app` | pass |

---

## PROVIDER CALL BUDGET

| Category | Budget | Used |
|---|---|---|
| Speech Lock pair | 2 | 2 |
| Memory Recall pair | 2 | 2 |
| Production 3500 recovery (V4.1) | 2 | 2 |
| **Total** | **6 max** | **6** |
| Billing replay | 0 | 0 |

---

## PROOF

- `smoke-fixture-taxonomy.json`
- `evidence-correction/operational.json`
- `evidence-correction/samples/*`
- `deepseekV41EvidenceCorrection.test.ts`

---

## FINAL CLASSIFICATION

### **`READY_FOR_PUBLIC_PICKER_PR`**

Hidden integration accepted; evidence gaps closed. Separate small PR may enable picker.

**Remaining launch blockers (not this PR):**
- V4 Pro peak-price reconciliation before public price-family positioning
- GPT qualitative review of blind samples (not scored by Cursor)

**MERGE = NO · STOP for GPT review.**
