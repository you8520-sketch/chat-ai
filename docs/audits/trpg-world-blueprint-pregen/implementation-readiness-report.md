# P0 — World-Revision Blueprint Pregeneration — Implementation Readiness

**Status:** STOP_BEFORE_MERGE (Draft PR #749 — queue-lifecycle correction)  
**Date:** 2026-08-30  
**PR base:** `82eaa51e8d9c83d8cbcd1d244cf4a1b2eafc6f9a`

---

## Queue-lifecycle correction (round 4)

| Issue | Fix |
|-------|-----|
| Failed terminal tombstone | `enqueueDerivedCacheJobReplacingTerminal` discards done/failed rows before explicit re-enqueue |
| Validity/dedupe mismatch | `enqueueWorldBlueprintPregenJob` skips when valid artifact exists; replaces terminal when invalid |
| Disabled-world execution | `canExecuteWorldBlueprintPregen` — flag ON + world exists + trpg_enabled |
| Deleted-world pending job | Worker discards when execution ineligible |

---

## Validation

- `worldBlueprintPregen.test.ts` — 39/39 (T1–T35 + R1)
- `scenarioDraftCall.transport.test.ts` — 13/13
- `typecheck:app`, `lint`, `git diff --check` — pass
