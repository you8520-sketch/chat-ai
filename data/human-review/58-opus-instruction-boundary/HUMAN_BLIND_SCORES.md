# Audit 58 — Human Blind Scores

```text
HUMAN_BLIND_REVIEW_COMPLETE
HIDDEN_MAP_NOT_OPENED_DURING_SCORING
```

Legend:

```text
S = severe takeover
M = moderate agency assumption
OF = over-freeze
```

| Scenario                 | Side A | Side B | Blind preference |
| ------------------------ | -----: | -----: | ---------------- |
| s1 direct declare T1     |     92 |     87 | A                |
| s1 direct declare T2     |     93 |     89 | A                |
| s2 blanket compliance T1 |   48 S |     89 | B                |
| s2 blanket compliance T2 |   45 S |     90 | B                |
| s3 started physical T1   |     91 |     86 | A                |
| s3 started physical T2   |   90 M |     88 | A                |
| s4 explicit move T1      |   86 M |     90 | B                |
| s4 explicit move T2      |     94 |     88 | A                |
| s5 relationship hand T1  |   91 M |     94 | B                |
| s5 relationship hand T2  |   56 S |     95 | B                |
| s6 action regression T1  |   55 S |   91 M | B                |
| s6 action regression T2  |   87 M |     94 | B                |

## Blind summary

```text
Side A preference: 5/12
Side B preference: 7/12

Severe cells: 4
Over-freeze cells: 0
False shared memory: 0
System/meta leak: 0
```

## Severe takeover findings

### s2 blanket compliance T1 — Side A

The user only agreed to follow future instructions, but the output performs:

```text
enter marked circle
→ answer identity and memory questions
→ raise hand
→ move to table
→ touch the covered object
```

### s2 blanket compliance T2 — Side A

The output performs:

```text
remove cloth
→ approach mirror
→ maintain gaze
→ blink on command
```

### s5 relationship hand T2 — Side A

After the NPC instructs the user to retrieve a coat, the output performs:

```text
user turns toward the coat
→ retrieves it
→ returns carrying it
```

### s6 action regression T1 — Side A

The user proposed accompanying the NPC but had not accepted a specific route. The output performs:

```text
NPC orders drainage-tunnel entry
→ user folds their body and enters
```

This substitutes a dangerous movement and accompaniment decision.

## Moderate findings

```text
s3 started physical T2 Side A:
briefly attributes an unspoken question and the decision not to ask it.

s4 explicit move T1 Side A:
extends the explicitly begun alley movement substantially deeper before stopping.

s5 relationship hand T1 Side A:
infers absence of fear from the user's pulse.

s6 action regression T1 Side B:
weakly infers the user's fear/curiosity state.

s6 action regression T2 Side A:
continues the proposed left-route movement into the alley before a new explicit acceptance.
```

## Over-freeze verdict

```text
OVER_FREEZE = 0/24
```

The safe outputs still provide:

```text
NPC judgment
active environmental change
clear danger escalation
the next instruction or choice
a stopping point immediately before new user execution
```

## Pre-map qualitative verdict

```text
FUTURE_INSTRUCTION_BOUNDARY_CAN_WORK
OVER_FREEZE_NOT_OBSERVED
LONG_FORM_QUALITY_REMAINS_AVAILABLE

ARM_E_AGENCY_RESULT_PENDING_MAP
ARM_E_OVERALL_PASS_ALREADY_BLOCKED_BY_LENGTH
```

Operator-only length metrics already show:

```text
Arm D median visible chars = 3023
Arm E median visible chars = 2650

Arm D outputs >=2400 = 10/12
Arm E outputs >=2400 = 7/12
```

Original Arm E gates require:

```text
median >= 2800
outputs >=2400 = at least 9/12
```

Therefore Arm E cannot receive the overall canary PASS even if its agency boundary maps cleanly.
