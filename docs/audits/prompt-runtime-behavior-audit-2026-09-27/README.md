# Prompt / Runtime Behavior Audit (2026-09-27)

Offline + live **AUDIT ONLY** against EXACT MAIN `c127d303`.  
**No production prompt / adapter / route / flag changes.**

## How to reproduce

```bash
npx tsx scripts/audit-prompt-runtime-behavior-inventory.ts
# requires CHEAPER_INFERENCE_BENCHMARK_API_KEY
npx tsx scripts/audit-prompt-runtime-behavior-baseline-live.ts
```

## Key files

| File | Role |
|---|---|
| `AUDIT_REPORT.md` | Full final report (required sections) |
| `ACTIVE_MODEL_INVENTORY.json` | 6 Main RP models + adapters + tokens |
| `RECEIPT_TOKEN_TRUTH.json` | Receipt A–F accounting |
| `MODEL_TOKEN_SUMMARY.json` | Per-model token buckets |
| `models/<id>/system.txt` | Exact assembled system prompt |
| `models/<id>/user-turn.txt` | Exact current user turn (provider-ready) |
| `models/<id>/sections.json` | Section order/role/chars/tokens |
| `baseline/` | Live raw outputs + objective annotations |
| `BASELINE_SUMMARY.md` | Annotation table (no scores) |
| `FIXTURES.json` | Synthetic quiet / banter / tension fixtures |

## Classification

`AUDIT_COMPLETE`
