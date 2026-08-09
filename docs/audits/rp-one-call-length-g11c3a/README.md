# G11-C3A — One-call length root-cause forensic audit

API=0 forensic inventory only. No prompt/owner/route edits. No live LLM calls.

## Sealed priors (do not rejudge)

- #295 DYNAMIC_DIALOGUE_BUDGET_PASS
- #296 SERVER_CONTROL_PASS_LENGTH_STABILITY_REMAINS
- #297 SINGLE_TERMINAL_LONGFORM_CONTRACT_FAIL
- #298 POSITIVE_PROSE_SPACE_FAIL
- #300 BASELINE_GEMINI_LENGTH_INSTABILITY (`SERVER_CONTROL_LENGTH_TAX = NOT SUPPORTED`)

## Artifacts

- `00_FORENSIC_INVENTORY.json` — full inventory
- `01_REQUEST_DIFF.json` — machine-readable request diff
- `02_REQUEST_DIFF.md` — table
- `03_OWNER_PRESSURE_MAP.md` — owner hashes + pressure
- `snapshots/C1_ARM_A_{B,D,F}_sanitized.json` — sanitized request snapshots
- `historical/` — extracted PR #255 reference slices
- `PHASE_G11_C3A_FINAL.md` — seal

## Reproduce (no network LLM)

```bash
FIXTURES=B,D,F node --conditions=react-server --import tsx \
  scripts/rp-quality-g11c3a-one-call-length-forensic.ts
```

Requires PR #255 COST extract at `/tmp/c3a-hist/COST_RESULTS.json` (or checkout that PR’s audit files).
