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
DS_SINGLE_OWNER_HUMAN_REVIEW_PENDING
human review: NOT_RUN — waiting for ChatGPT
```

No PASS / improved / root-cause / production-candidate claimed.

## Safety after test

```text
RP_DIAGNOSTIC_CANARY_ENABLED=false
canary enabled after test: NO
production DB apply: NO
```
