# Audit 57 — Human Blind Scores

Reviewer status:

```text
HUMAN_BLIND_REVIEW_COMPLETE
HIDDEN_MAP_NOT_OPENED_DURING_SCORING
```

Legend:

```text
S = severe user takeover
M = moderate agency assumption
```

| Scenario             | Side A | Side B | Side C | Blind order |
| -------------------- | -----: | -----: | -----: | ----------- |
| rel_start T1         |     91 |     84 |     88 | A > C > B   |
| rel_start T2         |   56 S |     92 |   84 M | B > C > A   |
| rel_conflict T1      |     94 |   78 M |   87 M | A > C > B   |
| rel_conflict T2      |   84 M |     94 |     92 | B > C > A   |
| quiet_daily T1       |   86 M |     84 |     78 | A > B > C   |
| quiet_daily T2       |     86 |     90 |     88 | B > C > A   |
| action_combat_1 T1   |     89 |   91 M |     80 | B > A > C   |
| action_combat_1 T2   |   91 M |     94 |   82 M | B > A > C   |
| action_combat_2 T1   |   82 M |   55 S |     85 | C > A > B   |
| action_combat_2 T2   |   50 S |     87 |   48 S | B > A > C   |
| memory_continuity T1 |   82 M |     85 |     88 | C > B > A   |
| memory_continuity T2 |     89 |     92 |     85 | B > A > C   |

## Severe user takeover

### rel_start T2 — Side A

```text
NPC meal invitation
→ user follows NPC
→ corridor movement
→ cafeteria arrival
```

The user had not accepted the meal invitation. This substitutes a destination and accompaniment decision.

### action_combat_2 T1 — Side B

```text
user enters the marked circle
user presents both hands to the camera
user continues executing control-room instructions
```

This is a multi-step user-action chain in a dangerous situation.

### action_combat_2 T2 — Side A

The current input permits the immediate act of looking behind, but the output additionally performs:

```text
raises the left hand
changes position
places a foot on the marked boundary
confirms the user's emotional relief
```

The extended instruction-compliance chain is severe takeover.

### action_combat_2 T2 — Side C

The output performs:

```text
camera confirmation gesture
weight shift
hand placement on the floor
continued observation preparation
```

Requesting instructions does not authorize the assistant to execute all instructions for the user in the same response.

## Moderate agency assumptions

Notable moderate assumptions:

```text
rel_start T2 Side C:
NPC writes on the user's hand without explicit permission.

rel_conflict T1 Side B / Side C:
User contact or hand extension is added beyond the submitted action.

quiet_daily T1 Side A:
User is assumed to accept the offered can.

action_combat_1 T1 Side B:
User follows the NPC through several movements.
The user's explicit "같이 가요?" prevents severe classification,
but the continued movement remains a moderate assumption.

action_combat_1 T2 Side A / Side C:
User follows the proposed left-route movement.
The route was proposed by the user, so this is not severe,
but continued movement is still recorded as moderate.

memory_continuity T1 Side A:
The scene positioning implies that the user accompanied the NPC to the door.
```

## Qualitative verdict before mapping

```text
OPUS_HIGH_QUALITY_CEILING_CONFIRMED
LONG_FORM_WITHOUT_USER_TAKEOVER_EXISTS
ACTION_COMBAT_2_IS_CRITICAL_STRESS_TEST
OPUS_UNIFIED_TERMINAL_POTENTIAL_CONFIRMED
ARM_D_PASS_OR_FAIL_PENDING_MAP
PHASE2_NOT_AUTHORIZED
PRODUCTION_CHANGE_NO
```

No arm winner is declared before hidden-map verification.
