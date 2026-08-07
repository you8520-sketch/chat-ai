# MAPPED_HUMAN_VERDICT — Audit 58

```text
HUMAN_BLIND_REVIEW_COMPLETE
HIDDEN_MAP_SEAL_VERIFIED
OPUS_INSTRUCTION_BOUNDARY_AGENCY_PASS
OPUS_INSTRUCTION_BOUNDARY_CANARY_OVERALL_FAIL_LENGTH
```

## Side-to-arm mapping

| Scenario | Turn | Side A | Side B |
|---|---|---|---|
| `s1_direct_declare_plus_instruction` | T1 | D | E |
| `s1_direct_declare_plus_instruction` | T2 | D | E |
| `s2_blanket_compliance` | T1 | D | E |
| `s2_blanket_compliance` | T2 | D | E |
| `s3_started_physical` | T1 | D | E |
| `s3_started_physical` | T2 | D | E |
| `s4_explicit_move` | T1 | D | E |
| `s4_explicit_move` | T2 | E | D |
| `s5_relationship_hand` | T1 | E | D |
| `s5_relationship_hand` | T2 | D | E |
| `s6_action_combat_1_regression` | T1 | D | E |
| `s6_action_combat_1_regression` | T2 | E | D |

## Mapped cell scores

| Scenario | Turn | Arm | Side | Score | Flags | Pref win |
|---|---|---|---|---:|---|---|
| `s1_direct_declare_plus_instruction` | T1 | D | A | 92 | — | Y |
| `s1_direct_declare_plus_instruction` | T1 | E | B | 87 | — | N |
| `s1_direct_declare_plus_instruction` | T2 | D | A | 93 | — | Y |
| `s1_direct_declare_plus_instruction` | T2 | E | B | 89 | — | N |
| `s2_blanket_compliance` | T1 | D | A | 48 | S | N |
| `s2_blanket_compliance` | T1 | E | B | 89 | — | Y |
| `s2_blanket_compliance` | T2 | D | A | 45 | S | N |
| `s2_blanket_compliance` | T2 | E | B | 90 | — | Y |
| `s3_started_physical` | T1 | D | A | 91 | — | Y |
| `s3_started_physical` | T1 | E | B | 86 | — | N |
| `s3_started_physical` | T2 | D | A | 90 | M | Y |
| `s3_started_physical` | T2 | E | B | 88 | — | N |
| `s4_explicit_move` | T1 | D | A | 86 | M | N |
| `s4_explicit_move` | T1 | E | B | 90 | — | Y |
| `s4_explicit_move` | T2 | E | A | 94 | — | Y |
| `s4_explicit_move` | T2 | D | B | 88 | — | N |
| `s5_relationship_hand` | T1 | E | A | 91 | M | N |
| `s5_relationship_hand` | T1 | D | B | 94 | — | Y |
| `s5_relationship_hand` | T2 | D | A | 56 | S | N |
| `s5_relationship_hand` | T2 | E | B | 95 | — | Y |
| `s6_action_combat_1_regression` | T1 | D | A | 55 | S | N |
| `s6_action_combat_1_regression` | T1 | E | B | 91 | M | Y |
| `s6_action_combat_1_regression` | T2 | E | A | 87 | M | N |
| `s6_action_combat_1_regression` | T2 | D | B | 94 | — | Y |

## Arm D

```text
mean: 77.67
median: 88
minimum: 45
maximum: 94
instruction-scene mean: 69.5
action-scene mean: 84.0
relationship-scene mean: 75.0

severe instruction-following takeover: 4/12
all severe takeover: 4/12
moderate agency assumption: 2/12
over-freeze: 0/12
clean outputs: 6/12

pairwise wins: 6/12
median total visible chars: 3023
outputs >=2400: 10/12
average raw API cost: 126.79 KRW
cost per 85+ output: 127.26 KRW
false shared memory: 0/12
system/meta leak: 0/12
```

## Arm E

```text
mean: 89.75
median: 89
minimum: 86
maximum: 95
instruction-scene mean: 88.75
action-scene mean: 89.33
relationship-scene mean: 93.0

severe instruction-following takeover: 0/12
all severe takeover: 0/12
moderate agency assumption: 3/12
over-freeze: 0/12
clean outputs: 9/12

pairwise wins: 6/12
median total visible chars: 2650
outputs >=2400: 7/12
average raw API cost: 124.04 KRW
cost per 85+ output: 124.04 KRW
false shared memory: 0/12
system/meta leak: 0/12
```

## Blind preference (mapped)

```text
E > D: 6/12
D > E: 6/12
```

## Arm E verdict

```text
Arm E agency verdict: OPUS_INSTRUCTION_BOUNDARY_AGENCY_PASS
Arm E overall verdict: OPUS_INSTRUCTION_BOUNDARY_CANARY_OVERALL_FAIL_LENGTH
OPUS_INSTRUCTION_BOUNDARY_CANARY_PASS: NOT_RECORDED
```

## Next stage (not implemented)

```text
AGENCY_BOUNDARY_SOLVED
LENGTH_RECOVERY_REQUIRED
NEXT_WORDING_NOT_IMPLEMENTED
```

Agency boundary paragraph core is retained. Length recovery candidate replaces only the early-stop sentence:

```text
첫 번째로 새롭게 요구되는 [B]의 행동 직전에 멈춘다.
```

Proposed replacement (NOT applied, NOT called):

```text
새롭게 요구되는 [B]의 행동을 수행한 것으로 서술하지 않는다.
그 행동이 필요해질 때까지 [A]·NPC·환경의 판단, 행동, 위험 변화와 외부 결과는 계속 전개할 수 있다.
[B]의 실제 선택이나 수행 없이는 더 진행할 수 없는 지점에서 멈춘다.
```

No additional forbid rules. No automatic next canary.

## Style note (out of scope for this canary)

```text
ONE_SPOKEN_SENTENCE_PER_PARAGRAPH_FAIL: NOT_ADDED
LONG_INSTRUCTION_DIALOGUE_BLOCKS_FAIL: NOT_ADDED
prose/dialogue ratio: not used as pass/fail
```

## Audit 57 preserved

```text
OPUS_UNIFIED_TERMINAL_PHASE1_FAIL
ARM_D_ARCHITECTURE_PROMISING
ARM_D_SINGLE_AGENCY_BOUNDARY_FAIL
PHASE2_NOT_RUN
PRODUCTION_CHANGE_NO
```

## Safety

```text
automatic next canary: NO
Phase 2: NO
PR #250 modification: NO
PR #257 modification: NO
production DB apply: NO
general rollout: NO
public picker change: NO
pricing change: NO
auto merge: NO
auto deploy: NO
model-lineup decision: NO
```
