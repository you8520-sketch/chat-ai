# 40 — RP first-principles reset (payload audit)

## Revised conclusions

```text
LONG_LENGTH_PRESSURE_IS_A_CONTRIBUTING_AMPLIFIER
ROOT_CAUSE_NOT_YET_ISOLATED
EVALUATION_TARGET_MISALIGNMENT_CONFIRMED
```

Withdrawn: `FIXED_LONG_LENGTH_SPARSE_INPUT_CONFLICT_STRONGLY_SUPPORTED`.

PR #246 bake-off: `MODEL_BAKEOFF_NO_PASS` — closed without merge. No model confirmed. Claude dynamic-length: NOT RUN.

## Offline payload audit (DeepSeek V4 Pro)

Fixture: production character **18** / persona **61** / user **34**, reconstructed via `buildContext` (no live provider call).

| Stop condition | Result |
| --- | --- |
| `GREETING_DUPLICATED` | false (opening remap once) |
| `PREVIOUS_ASSISTANT_DUPLICATED` | false |
| `MULTIPLE_TERMINAL_LENGTH_OWNERS` | **true (3)** |
| `CONTRADICTORY_SCENE_OWNERS` | false |

```text
LIVE_FACTORIAL_BLOCKED
```

Round-1 factorial (A/B/C/D) was **not started**.

## Single-duplication canary (code only)

Variant: `ds_single_terminal_length_owner`

- Keeps `USER_TAIL_LENGTH_OWNER_SENTENCE` as the sole numeric length owner
- Suppresses `[DEEPSEEK LENGTH — SINGLE CALL]`, `[SHORT HISTORY]`, `[SHORT USER TURN]`, regen length extras
- Preserves style reminder + opening-scene peel

```text
canary enabled after test: NO
production DB apply: NO
live factorial: NOT_RUN
```

Offline verify: `scripts/verify-single-terminal-length-canary.ts` → `lengthCount: 1`.

## Next

Re-run payload anatomy with canary ON (still offline or gated live), confirm `MULTIPLE_TERMINAL_LENGTH_OWNERS=false`, then start Round-1 factorial.
