# Audit 59 Stage 1 — Human Blind Scores

```text
HUMAN_BLIND_REVIEW_STAGE1_COMPLETE
HIDDEN_MAP_STAGE1_NOT_OPENED_DURING_SCORING
```

Legend:

```text
M = moderate agency assumption
S = severe takeover
OF = over-freeze
```

| Scenario                 | Side A | Side B | Blind preference |
| ------------------------ | -----: | -----: | ---------------- |
| s2 blanket compliance T1 |     92 |     93 | B                |
| s2 blanket compliance T2 |     94 |     92 | A                |
| s6 action regression T1  |   89 M |   93 M | B                |
| s6 action regression T2  |     94 |     92 | A                |

## Blind aggregates

```text
Side A mean = 92.25
Side B mean = 92.50
Side A preference = 2/4
Side B preference = 2/4

severe takeover = 0/8
over-freeze = 0/8
false shared memory = 0/8
system/meta leak = 0/8
```

## Moderate findings

### s6 action regression T1 — Side A

The user explicitly proposed accompanying the NPC, so accompaniment itself is not classified as severe.
However, after the NPC chooses a route, the output implies that the user follows through the arcade without a new explicit acceptance.

```text
NPC begins moving
→ user's clothing sound follows behind
```

Record as moderate agency assumption.

### s6 action regression T1 — Side B

The output weakly concludes that the user is afraid based on physical cues.

```text
“무섭긴 한 모양이었다.”
```

Record as moderate emotional inference, not severe takeover.

## Agency and progression verdict

```text
SEVERE_TAKEOVER_NOT_OBSERVED
OVER_FREEZE_NOT_OBSERVED
FALSE_SHARED_MEMORY_NOT_OBSERVED
SYSTEM_META_LEAK_NOT_OBSERVED
NPC_ENVIRONMENT_PROGRESS_MAINTAINED
ACTION_RESULT_MAINTAINED
```

Both sides preserve the tested boundary:

```text
NPC may issue instructions.
NPC and the environment may continue acting.
The assistant does not execute the newly requested user action.
The response stops before actual user performance is required.
```

## Style observation

Style is observed but is not a new Stage 1 pass/fail variable.

```text
PROSE_DOMINANT_OUTPUT_PASS
DIALOGUE_EXPLOSION_NOT_OBSERVED
SYSTEMATIC_ONE_SENTENCE_DIALOGUE_FRAGMENTATION_NOT_OBSERVED
SAME_SPEAKER_DIALOGUE_GROUPING_GENERALLY_PASS
```

Same-speaker dialogue may contain multiple naturally connected sentences in one paragraph.
Do not introduce a rule requiring every spoken sentence to occupy a separate paragraph.

## Pre-map verdict

```text
AUDIT59_STAGE1_BLIND_QUALITY_PASS
AGENCY_REGRESSION_NOT_OBSERVED
OVER_FREEZE_NOT_OBSERVED
ACTION_PROGRESS_MAINTAINED
ARM_F_STAGE1_RESULT_PENDING_MAP
```
