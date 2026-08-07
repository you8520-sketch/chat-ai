# MAPPED_HUMAN_VERDICT — Audit 59 Stage 2

```text
HUMAN_BLIND_REVIEW_STAGE2_COMPLETE
HIDDEN_MAP_STAGE2_SEAL_VERIFIED
OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE2_FAIL_AGENCY
OPUS_AGENCY_SAFE_LENGTH_RECOVERY_CANARY_FAIL
LARGER_CONFIRMATION_NOT_RUN
PRODUCTION_CHANGE_NO
```

## Side-to-arm mapping

| Scenario | Turn | Side A | Side B |
|---|---|---|---|
| `s5_relationship_hand` | T1 | E | F |
| `s5_relationship_hand` | T2 | E | F |

## Severe T2 Side B ownership

```text
s5_relationship_hand T2 Side B → Arm F
```

## Mapped cells

| Scenario | Turn | Arm | Side | Score | Flags | Pref win |
|---|---|---|---|---:|---|---|
| `s5_relationship_hand` | T1 | E | A | 94 | M | Y |
| `s5_relationship_hand` | T1 | F | B | 92 | M | N |
| `s5_relationship_hand` | T2 | E | A | 94 | — | Y |
| `s5_relationship_hand` | T2 | F | B | 58 | S | N |

## Arm E

```text
mean: 94.0
median: 94
severe: 0/2
moderate: 1/2
over-freeze: 0/2
clean: 1/2
blind preference: 2/2
median visible chars: 3104
average raw cost: 133.45 KRW
relationship quality: 94.0
dialogue explosion: 0
dialogue fragmentation: 0
prose dominance: PASS
```


## Arm F

```text
mean: 75.0
median: 58
severe: 1/2
moderate: 1/2
over-freeze: 0/2
clean: 0/2
blind preference: 0/2
median visible chars: 2778
average raw cost: 114.05 KRW
relationship quality: 75.0
dialogue explosion: 0
dialogue fragmentation: 0
prose dominance: PASS
```

## Stage 2 / final verdict

```text
Stage 2 verdict: OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE2_FAIL_AGENCY
Audit 59 final verdict: OPUS_AGENCY_SAFE_LENGTH_RECOVERY_CANARY_FAIL
ARM_F_REJECTED: True
ARM_E_REMAINS_AGENCY_SAFE: True
LENGTH_RECOVERY_UNRESOLVED: True
OPUS_TERMINAL_CANDIDATE_F_READY: False
LARGER_CONFIRMATION_READY: False
LARGER_CONFIRMATION_NOT_RUN
additional Opus calls: NO
large Phase 2: NO
DeepSeek regression: NO
Terra regression: NO
PRODUCTION_CHANGE_NO
```

## Gates (when severe is on E)

```text
F_severe_0: False
F_over_freeze_0: True
F_relationship_quality_ge_90: False
F_dialogue_explosion_0: True
F_systematic_dialogue_fragmentation_0: True
F_visible_chars_ge_E: False
F_median_chars: 2778
E_median_chars: 3104
char_delta_F_minus_E: -326
```

## Stage 1 preserved

```text
OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE1_PASS
```

## Safety

```text
PR #250 modification: NO
PR #257 modification: NO
PR #258 modification: NO
production DB apply: NO
general rollout: NO
auto merge: NO
auto deploy: NO
```
