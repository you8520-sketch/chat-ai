# B10-2 live run log

- **Date (UTC):** 2026-10-20
- **Budget cap:** 500 KRW (task-local); **spent:** ~25.1 KRW (`apiRawCostKrw` sum)
- **Model:** Gemini 3.8 Flash only (`google/gemini-3.8-flash`, OpenRouter, SAFE)
- **Stop rule:** A×3 with no B10-1-style reproduction → **no B calls**

## Procedure

1. Dry A/B validate (`dry-gate/validation.json`) — single-sentence diff only.
2. Live A: `t50-A-1`, `t50-A-2`, `t50-A-3` — one POST each, no retry.
3. Classify with `scripts/classify-runs.py.txt` → `a-classification.json`.
4. `anyReproduction: false` → STOP (per task §9).

## Paid calls

| Run | Request SHA-256 (full) | Request ID | Finish | Chars | apiRawCostKrw | input / output tokens | cache read |
|---|---|---|---|---:|---:|---:|---:|
| t50-A-1 | `49475a3df82469187890340b873319cd008cf5eac7bec4a11eab119091fd0458` | `srv_mvgbpwy3_lxj1vqqw` | stop | 2213 | 5.9 | 13992 / 1413 | 12777 |
| t50-A-2 | same | `srv_mvgbqd17_efhotd04` | stop | 4534 | 9.7 | 13992 / 2873 | 12777 |
| t50-A-3 | same | `srv_mvgbr6di_dk0ea4o3` | stop | 4403 | 9.5 | 13992 / 2828 | 12777 |

Ledger append: `paid-main-rp.log`.

## Harness (VM-only, not product code)

Scripts copied as `.txt` under `scripts/` for audit. Runtime used B9-1 snap DB + admin env; Luna/embeddings stubbed; B variant would patch wire JSON only in `t50-ab-one.mts`.

**Note:** First dry validate may have attempted a live stream before stub short-circuit; live A runs completed normally.
