# B10-2 live run log

- **Date (UTC):** 2026-10-20
- **Model:** Gemini 3.8 Flash (`google/gemini-3.8-flash`, OpenRouter, SAFE)
- **Budget:** A phase ~25.1 KRW; **B phase ~23.7 KRW** (additional cap 500 KRW)

## Request SHA-256 (verified pre-send on live harness)

| Variant | SHA-256 |
|---|---|
| A (production sentence) | `49475a3df82469187890340b873319cd008cf5eac7bec4a11eab119091fd0458` |
| B (one-sentence wire swap) | `f3f838ee6613608153ffcc6fe6e0c5eaef2aeeb93bd0f5dca833b5b3989f3803` |

Dry recheck: `dry-gate/validation-recheck.json` (`diffVerified: true`).

## Phase A (historical — not re-run after GPT re-review)

| Run | Request ID | Chars | apiRawCostKrw | in/out tokens | cache read |
|---|---|---:|---:|---:|---:|
| t50-A-1 | `srv_mvgbpwy3_lxj1vqqw` | 2213 | 5.9 | 13992 / 1413 | 12777 |
| t50-A-2 | `srv_mvgbqd17_efhotd04` | 4534 | 9.7 | 13992 / 2873 | 12777 |
| t50-A-3 | `srv_mvgbr6di_dk0ea4o3` | 4403 | 9.5 | 13992 / 2828 | 12777 |

## Phase B (post re-review — 3 calls only)

Each run: fresh `snap-50` copy, same user question, B wire SHA enforced in harness.

| Run | Request ID | Chars | apiRawCostKrw | in/out tokens | cache read |
|---|---|---:|---:|---:|---:|
| t50-B-1 | `srv_mvgcliiw_yolv58an` | 4132 | 9.3 | 14019 / 2608 | 12777 |
| t50-B-2 | `srv_mvgcm9uq_t73i3vdl` | 2816 | 6.5 | 14019 / 1784 | 12777 |
| t50-B-3 | `srv_mvgcmsxs_95a7e4w6` | 3569 | 7.9 | 14019 / 2243 | 12777 |

## Safety notes

- Main RP: one OpenRouter POST per run; Luna/summary stubs return SSE (summary compose may fail — acceptable, no extra paid aux).
- Dry validate: fetch interceptor returns stub body `"dry"` without billing; OpenRouter client may still log a local “request” line — no provider `cost` on dry path.
- Harness requires `ADMIN_EMAILS` for char 18 (`nsfw=1`) admin gate — set via `/tmp/b9/admin.env` or harness default (not a product change).

## Scripts (VM copies as `.txt`)

`scripts/t50-ab-one.mts.txt`, `run-b-loop.sh.txt`, `run-b-only.sh.txt`, `classify-runs.py.txt`
