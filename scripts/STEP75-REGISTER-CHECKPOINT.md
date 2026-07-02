# Step 7.5 — Character Dialogue Register (CHECKPOINT)

**Updated:** 2026-07-02  
**Status:** ✅ Patch **A** applied to production. Validation complete.

## Winner — Patch A

Remove dialogue register from `[genre_tone]`; restore Step 4.3 atmosphere-only hints.

| Patch | compliance | 10-pair | human | smell |
|-------|------------|---------|-------|-------|
| none (legacy) | 41.4% | FAIL | 6.2 | 3.0 |
| step43 | 43.1% | PASS | 5.7 | 3.5 |
| **A** | **48.1%** | **PASS** | 5.8 | 3.8 |
| B | 40.4% | FAIL | 5.9 | 3.4 |
| C | 42.0% | FAIL | 5.6 | 3.4 |
| D | 33.4% | FAIL | 5.7 | 3.5 |

Report: `output/step75-register-patch-validation.md`

## Production change

- `resolveGenreToneHints()` → `STEP43_GENRE_TONE_HINTS` when `REGISTER_PATCH` unset
- `REGISTER_PATCH=none` → `LEGACY_GENRE_TONE_HINTS` (audit baseline only)
- B/C/D remain behind env for re-audit; not in production

## Not applied (lower impact)

- **B** metadata wiring at canon — compliance ↓
- **C** genre before prose — no gain
- **D** canon recency tail — worst compliance

## Re-run validation

```powershell
npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --all-patches
```

Full regenerate (legacy baseline needs `REGISTER_PATCH=none`):

```powershell
npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --all-patches --generate
```
