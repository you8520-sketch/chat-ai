# DeepSeek V4.1 Flash — Launch-Proof Integrity Correction

**Date:** 2026-09-21  
**Exact reviewed head:** `a9afe0a3146ba10d23bb842b15a2b8e74b8bf42c`  
**MERGE = NO · PUBLIC_PICKER_ENABLE = NO · PROVIDER_CALLS = 0**

---

## EXACT HEAD

Integrity pass builds on evidence commit `a9afe0a3` at reviewed head `a9afe0a3…`.

---

## LIVE RECOVERY CLAIM CORRECTION

Prior report implied `assistantRowCount: 1` / `settlementCount: 1` from live recovery harness.

**Finding:** Those fields were **literal audit constants**, not route/DB measurements.

**Correct classification:** `NOT_VERIFIED_BY_LIVE_RECOVERY_HARNESS`

Live harness valid proof:
- merge triggered (1471 → 3047 chars)
- 85% floor met (2975)
- sentence complete heuristic

Not claimed from live harness:
- assistant row exactly once
- settlement exactly once

Artifact updated: `evidence-correction/operational.json` → `routeLifecycleVerified`.

---

## EXISTING RECOVERY LIFECYCLE OWNER

Canonical deterministic owners (reused, not duplicated):

| Invariant | Owner |
|---|---|
| Recovery merge / no duplicate tail | `recoveryMergeDiagnostic.test.ts` |
| Primary + recovery billing aggregation | `turnBillableUsage.test.ts` S3 |
| Settlement exactly once | `chatBillingDeliveryIntegrity.test.ts` D10 |
| Assistant finalize idempotent | `streamingPersistence.test.ts` |

---

## EXACTLY-ONCE PROOF

**Provider call 0** deterministic composition in `deepseekV41EvidenceCorrection.test.ts`:

1. `traceRecoveryMerge` — under-length primary + recovery extends prose
2. `bootstrapStreamingTurn` + `finalizeAssistantMessage` — **1 assistant row**
3. `settleChatTurnBillingExactlyOnce` — **1 settlement**; replay → duplicate

Post-turn memory lifecycle exactly-once remains owned by memory suite (#968/#969/#970/#977) — out of scope.

---

## OLD BILLING REPLAY RECLASSIFICATION

`rp-ab/operational.json` (historical blind smoke):

- Coerced absent cache via `?? 0`
- No `usageReportingEvidence`

**Not:** EXACT HISTORICAL RAW-EVIDENCE REPLAY  
**Correct:** PRODUCTION-EQUIVALENT SYNTHETIC REPLAY USING CAPTURED TOKEN VALUES

Superseded for billing proof by `evidence-correction/operational.json` new live captures.

---

## NEW LIVE SPEECH BILLING REPLAY

Source: `TRUE_speech_lock` V4.1 row in `evidence-correction/operational.json`

| Field | Artifact value |
|---|---|
| input / output | 5211 / 1974 |
| cacheRead evidence | reported_valid |
| cacheWrite evidence | **unreported** |
| reasoning evidence | **unreported** |

→ `published_phase2` · `phase2_deepseek_live_grade` · pricingVersion **1** · complete

---

## NEW LIVE MEMORY BILLING REPLAY

Source: `TRUE_memory_recall` V4.1 row

| Field | Artifact value |
|---|---|
| input / output | 5301 / 1164 |
| cacheRead tokens | **1664** |
| cacheWrite evidence | **unreported** |

→ `published_phase2` complete v1

---

## CACHE-WRITE ACTUAL EVIDENCE

Live captures: `cacheWrite = unreported` (not coerced to 0).

Canonical billing owner resolves → `MISSING_BUT_PROVEN_ZERO` (separate **billed cache-write bucket** absent — not “no physical cache persistence”).

Positive cacheWrite (128) → `unsupported_cache_semantics` → legacy blocked.

---

## MEMORY EVIDENCE SCOPE

TRUE Memory Recall validates:

**PRODUCTION MEMORY-INJECTION CONSUMPTION PASS**

(`buildContext` + `longTermMemory` + `mediumTermMemoryBlock`)

**Not claimed:** END-TO-END EPISODIC DB RETRIEVAL (memory lane owners #968–#977).

---

## PICKER OFF

Regression: V4.1 absent from `MAIN_RP_USER_SELECTABLE_OPTIONS`.

---

## CI STATUS

| Check | Result |
|---|---|
| `deepseekV41EvidenceCorrection.test.ts` | pass |
| `deepseekV41FlashIntegration.test.ts` | 20/20 |
| `npm run lint` / `typecheck:app` | pass |

**PROVIDER_CALLS this pass:** 0

---

## PROOF

- `LAUNCH_PROOF_INTEGRITY_REPORT.md` (this file)
- `evidence-correction/operational.json` (corrected lifecycle fields)
- `src/lib/deepseekV41EvidenceCorrection.test.ts`

---

## FINAL CLASSIFICATION

### **`READY_FOR_PUBLIC_PICKER_PR`**

Evidence claims corrected; exact live-evidence billing replay passes; exactly-once proven via deterministic route owners (0 provider calls).

**MERGE = NO · STOP for GPT review.**
