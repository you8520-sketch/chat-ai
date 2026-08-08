# B1_D2_MAIN_REFRESH_SEAL

```
B1_D2_MAIN_REFRESH_SEAL:

latest main: 522f4810670bab639fb8800bc5eee4a125895a6b
rebased/merged head: 6aff2f4eda1db247ebe6ac01edd5712d8a0a2b19
implementation tip (clock regression): 94a95c375c326ddae1357548fb8406d66a0d2c87

conflicts:
NONE

B1-D2 tests:
PASS (28/28 — includes nonnumeric clock C→B restore)

status-widget #281 regressions:
PASS (temporalUnknown + extractRetry — 81/81)

variant time snapshot:
C 10:30 → B 10:15
PASS

variant select advanced clock:
NO
(advanceUnchangedClockValuesForTurn not imported by variant path)

route canary:
PASS

HTTP canonical parity:
PASS

regen E preservation:
PASS

LLM calls:
0

lint:
PASS

typecheck:
PASS

git diff --check:
PASS

final:
B1_D2_MERGE_READY

merge:
NOT_RUN
```

## Notes

- Clean rebase of `cursor/rp-numeric-state-variant-switch-b1d2-96c2` onto `origin/main` (#281 time fix included).
- No design/feature changes beyond one regression asserting nonnumeric clock snapshot restore on variant select.
- Variant selection is not a completed RP turn; clock advance from #281 must not run on switch.
