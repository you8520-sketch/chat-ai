# 41 — DeepSeek triple length owner vs single terminal owner

## Offline parity

```text
DS_SINGLE_OWNER_FULL_PAYLOAD_PARITY_PASS
production length owner count (T1) = 3
canary length owner count (T1/T2) = 1
```

## Live A/B

| Arm | Label | Valid | Calls | Repl | Avg/Min/Max chars |
| --- | --- | ---: | ---: | ---: | --- |
| A | PRODUCTION_TRIPLE_OWNER | 4 | 5 | 1 | 2882 / 2139 / 3267 |
| B | SINGLE_TERMINAL_OWNER (`ds_single_terminal_length_owner`) | 4 | 6 | 1 | 3285 / 2538 / 4620 |

Provider: `cheaperinference` · model: `deepseek-v4-pro`

## Status

```text
DS_SINGLE_OWNER_SCREEN_FAIL
SINGLE_OWNER_QUALITY_IMPROVEMENT_NOT_REPRODUCED
REDUNDANT_LENGTH_STACK_IS_A_REAL_CONFIGURATION_BUG
REDUNDANT_LENGTH_STACK_PRIMARY_CAUSE_NOT_CONFIRMED
HARD_FAIL_DETECTOR_GENERALIZATION_FAIL
```

Human blind preferences: R1T1 A>B · R1T2 A>>>B · R2T1 B>A · R2T2 B>A.

PR #247 remains draft / unmerged / not a production candidate. No single-owner confirmation.

## Safety after test

```text
RP_DIAGNOSTIC_CANARY_ENABLED=false
canary enabled after test: NO
production DB apply: NO
```
