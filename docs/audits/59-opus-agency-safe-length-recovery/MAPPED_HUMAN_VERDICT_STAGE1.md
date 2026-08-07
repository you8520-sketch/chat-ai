# MAPPED_HUMAN_VERDICT — Audit 59 Stage 1

```text
HUMAN_BLIND_REVIEW_STAGE1_COMPLETE
HIDDEN_MAP_STAGE1_SEAL_VERIFIED
OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE1_PASS
STAGE2_AUTHORIZED
```

## Side-to-arm mapping

| Scenario | Turn | Side A | Side B |
|---|---|---|---|
| `s2_blanket_compliance` | T1 | E | F |
| `s2_blanket_compliance` | T2 | F | E |
| `s6_action_combat_1_regression` | T1 | F | E |
| `s6_action_combat_1_regression` | T2 | F | E |

## Mapped cells

| Scenario | Turn | Arm | Side | Score | Flags | Pref win |
|---|---|---|---|---:|---|---|
| `s2_blanket_compliance` | T1 | E | A | 92 | — | N |
| `s2_blanket_compliance` | T1 | F | B | 93 | — | Y |
| `s2_blanket_compliance` | T2 | F | A | 94 | — | Y |
| `s2_blanket_compliance` | T2 | E | B | 92 | — | N |
| `s6_action_combat_1_regression` | T1 | F | A | 89 | M | N |
| `s6_action_combat_1_regression` | T1 | E | B | 93 | M | Y |
| `s6_action_combat_1_regression` | T2 | F | A | 94 | — | Y |
| `s6_action_combat_1_regression` | T2 | E | B | 92 | — | N |

## Arm E

```text
mean: 92.25
median: 92
minimum: 92
maximum: 93
severe takeover: 0/4
moderate agency: 1/4
over-freeze: 0/4
clean outputs: 3/4
blind preference: 1/4
median visible chars: 2304
average raw cost: 132.93 KRW
meaningful AI-owned action progression: MAINTAINED
```


## Arm F

```text
mean: 92.5
median: 93
minimum: 89
maximum: 94
severe takeover: 0/4
moderate agency: 1/4
over-freeze: 0/4
clean outputs: 3/4
blind preference: 3/4
median visible chars: 2926
average raw cost: 130.78 KRW
meaningful AI-owned action progression: MAINTAINED
```

## Length delta

```text
F median − E median = 622
required: >= +200 → PASS
```

## Stage 1 gates

```text
F_severe_0: True
F_over_freeze_0: True
F_median_chars_ge_E_plus_200: True
F_mean_ge_E_minus_2: True
meaningful_ai_owned_action_progression: True
char_delta: 622
mean_delta_F_minus_E: 0.25
```

## Verdict

```text
OPUS_AGENCY_SAFE_LENGTH_RECOVERY_STAGE1_PASS
STAGE2_AUTHORIZED
PHASE2_NOT_RUN
PRODUCTION_CHANGE_NO
```

## Audit 58 preserved

```text
OPUS_INSTRUCTION_BOUNDARY_AGENCY_PASS
OPUS_INSTRUCTION_BOUNDARY_CANARY_OVERALL_FAIL_LENGTH
AGENCY_BOUNDARY_SOLVED
LENGTH_RECOVERY_REQUIRED
```
