# P0 — World-Revision Blueprint Pregeneration — Implementation Readiness

**Status:** STOP_BEFORE_MERGE (Draft PR #749 — atomic terminal replacement)

---

## Atomicity correction (round 5)

| Issue | Fix |
|-------|-----|
| Non-atomic SELECT→DELETE→INSERT terminal replacement | Single `INSERT ... ON CONFLICT DO UPDATE WHERE status IN ('done','failed')` in `jobs.ts` |

Terminal replacement is now concurrency-safe; pending/processing single-flight preserved.

---

## Validation

- `worldBlueprintPregen.test.ts` — 45/45 (T1–T40 + R1 + R2)
- `scenarioDraftCall.transport.test.ts` — 13/13
- `typecheck:app`, `lint`, `git diff --check` — pass
