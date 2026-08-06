# Audit 41 — Human blind verdict (ChatGPT)

Hidden map revealed after blind read:

```text
all Side X = ARM A production triple-owner
all Side Y = ARM B single-terminal-owner
```

Blind preferences:

```text
Run 1 Turn 1: A > B
Run 1 Turn 2: A >>> B
Run 2 Turn 1: B > A
Run 2 Turn 2: B > A
```

## Verdict codes

```text
DS_SINGLE_OWNER_SCREEN_FAIL
SINGLE_OWNER_QUALITY_IMPROVEMENT_NOT_REPRODUCED
REDUNDANT_LENGTH_STACK_IS_A_REAL_CONFIGURATION_BUG
REDUNDANT_LENGTH_STACK_PRIMARY_CAUSE_NOT_CONFIRMED
HARD_FAIL_DETECTOR_GENERALIZATION_FAIL
```

## Human hard failures

```text
ARM A:
- A-R2T1 unsupported user guide/ability assumption
- A-R2T2 unsupported user uniform/badge/guide-state invention
ARM B:
- B-R1T1 named-NPC scene intrusion
- B-R1T2 named-NPC/administrative takeover and primary-character exit
```

Automatic detector reported zero alarms for all eight outputs — detector must not declare PASS.

## Follow-ups

- PR #247 remains draft / unmerged / not a production candidate.
- Do **not** run single-owner confirmation.
- Next: Audit 42 Length × Scene 2×2 (ARM C/D only; A/B frozen).
- After human annotation of 2×2, add detector fixtures for the four hard fails above.
- Do not modify the detector before generating C/D outputs.
