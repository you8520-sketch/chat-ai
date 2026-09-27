# LENGTH_METRIC_CORRECTION — Audit 56

## Bug

Phase-1 scripts compared Hangul-only count `koreanChars(text)` against the `3,200~4,200자` target.

Production length uses **total visible display characters**:

```ts
visibleAssistantDisplayCharCount(finalText)
```

## Correction

Re-aggregated all 36 existing raw outputs with `visibleAssistantDisplayCharCount` (no API re-calls).

`visible_korean_chars` retained only as a language-hygiene auxiliary metric.

`COST_RESULTS.json` was **not** overwritten. See `COST_RESULTS_CORRECTED.json`.

## Summary

```text
old natural-stop counts: INVALID
```

| Arm | old natural-stop (INVALID) | corrected natural-stop (<3200 total visible) | in 3200–4200 | below 3200 | above 4200 | median total visible |
|---|---:|---:|---:|---:|---:|---:|
| A | 12 | 8 | 4 | 8 | 0 | 3086 |
| B | 12 | 12 | 0 | 12 | 0 | 973 |
| C | 12 | 12 | 0 | 12 | 0 | 749 |

```text
AUDIT56_LENGTH_METRIC_BUG
```
