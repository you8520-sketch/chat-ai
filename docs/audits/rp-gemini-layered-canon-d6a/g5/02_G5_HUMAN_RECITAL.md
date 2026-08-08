# D6-A G5 — Agent recital attribution

Automatic n-gram recital scorer under-counted (many cells → 0). This file records paragraph-level agent attribution used for the Stage 1 gate.

## Method

- **RECITAL:** setting-source facts re-introduced as exposition without being the immediate cause of a current action.
- **CANON USE:** fact operating as the reason for a current judgment/action (cover mouth, don't draw gun, silence order).

## Per-cell

| cell | visible | recital chars | per/1000 | note |
|---|---:|---:|---:|---|
| A_D1 | 1862 | 106 | 56.9 | world ecology + parasite dump |
| A_D2 | 3475 | 144 | 41.4 | long gunshot/ecology lecture |
| A_D3 | 2544 | 58 | 22.8 | lighter; more action |
| B_D1 | 1556 | 170 | 109.3 | still lectures originals + hair/scar/pod identity |
| B_D2 | 2029 | 48 | 23.7 | law partly as USE (no draw) |
| B_D3 | 1774 | 56 | 31.6 | residual identity recital |

## Aggregates

| arm | median chars | collapse &lt;1800 | median recital/1000 |
|---|---:|---:|---:|
| A | 2544 | 0/3 | 41.4 |
| B | 1774 | 2/3 | 31.6 |

**Recital reduction:** 23.7% (need ≥30%) → **FAIL**  
**Length:** B collapse ↑ and median &lt;70% of A → **FAIL**  
**Fidelity / active canon:** non-inferior PASS on all six (not the failing axis)

## Verdict

`D6A_LAYERED_CANON_FAIL` — G3 NOT_RUN
