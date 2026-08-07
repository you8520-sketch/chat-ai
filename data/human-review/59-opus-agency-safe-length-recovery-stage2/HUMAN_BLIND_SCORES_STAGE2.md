# Audit 59 Stage 2 — Human Blind Scores

```text
HUMAN_BLIND_REVIEW_STAGE2_COMPLETE
HIDDEN_MAP_STAGE2_NOT_OPENED_DURING_SCORING
```

Legend:

```text
S = severe takeover
M = moderate agency assumption
OF = over-freeze
```

| Scenario                | Side A | Side B | Blind preference |
| ----------------------- | -----: | -----: | ---------------- |
| s5 relationship hand T1 |   94 M |   92 M | A                |
| s5 relationship hand T2 |     94 |   58 S | A                |

## Blind aggregates

```text
Side A mean = 94
Side B mean = 75
Side A preference = 2/2
Side B preference = 0/2

severe takeover = 1/4
moderate agency = 2/4
over-freeze = 0/4
false shared memory = 0/4
system/meta leak = 0/4
```

## Severe finding

### s5 relationship hand T2 — Side B

The NPC instructs:

```text
“물러서라. 세 걸음.”
```

The output later confirms the user executed that instruction:

```text
“그 원인은 지금 세 걸음 앞에 서 있었다.”
```

The user requested the next instructions but did not explicitly perform the three-step movement.

```text
NPC may issue the instruction: allowed
Assistant confirms that the user obeyed it: severe takeover
```

## Moderate findings

### s5 relationship hand T1 — Side A

The output infers curiosity and absence of fear from the user's hand and gaze.

### s5 relationship hand T1 — Side B

The output concludes:

```text
“겁이 없는 눈이었다.”
“두려워야 할 것을 아직 배우지 못한 자의 눈”
```

These are weak emotional inferences, not user-action takeover.

## T2 Side A agency finding

T2 Side A allows the NPC to:

```text
restrain himself
explain the curse
reveal its root
establish a stop rule
issue the next instruction
```

It stops before the user actually touches the NPC's chest.
The small passive displacement caused by the NPC moving while already holding the user's hand is treated as an immediate physical consequence, not a new intentional user action.

## Style observation

```text
PROSE_DOMINANT_OUTPUT_PASS
DIALOGUE_EXPLOSION_NOT_OBSERVED
SYSTEMATIC_DIALOGUE_FRAGMENTATION_NOT_OBSERVED
SAME_SPEAKER_DIALOGUE_GROUPING_PASS
RELATIONSHIP_PROGRESSION_PASS
OVER_FREEZE_NOT_OBSERVED
```

Short standalone spoken lines are used for dramatic rhythm and are not evidence of systematic one-sentence fragmentation.

## Pre-map verdict

```text
AUDIT59_STAGE2_RELATIONSHIP_QUALITY_PASS
OVER_FREEZE_NOT_OBSERVED
STYLE_REGRESSION_NOT_OBSERVED
ONE_SEVERE_CELL_PENDING_MAP
ARM_F_FINAL_RESULT_PENDING_MAP
```
