# Prompt diff matrix — Length × Scene 2×2

## Offline verdict: `DS_LENGTH_X_SCENE_2X2_OFFLINE_PASS`

## Arm matrix

| Arm | Length owners (T1) | SceneDirective | Canary |
|---|---:|---|---|
| A | 3 | ON | (none / production) |
| B | 1 | ON | `ds_single_terminal_length_owner` |
| C | 3 | OFF | `ds_triple_owner_scene_off` |
| D | 1 | OFF | `ds_single_owner_scene_off` |

## Required pair isolation

| Pair | Turn | OK | User match | System−scene match | Non-scene tracked mismatches |
|---|---|---|---|---|---|
| A_vs_C_t1 | — | true | true | true | (none) |
| A_vs_C_t2 | — | true | true | true | (none) |
| B_vs_D_t1 | — | true | true | true | (none) |
| B_vs_D_t2 | — | true | true | true | (none) |

## Failure reasons (if any)

```json
{
  "A_vs_C_t1": [],
  "A_vs_C_t2": [],
  "B_vs_D_t1": [],
  "B_vs_D_t2": []
}
```

## Flag matrix Turn 1

| flag | A | B | C | D |
|---|---|---|---|---|
| deepseek_length | true | false | true | false |
| short_history | true | false | true | false |
| short_user | false | false | false | false |
| regen_length | false | false | false | false |
| user_tail | true | true | true | true |
| style_reminder | true | true | true | true |
| opening | true | true | true | true |
| scene_engine | false | false | false | false |
| scene_turn | false | false | false | false |

## Notes

- A/C retain production triple length stack (DEEPSEEK LENGTH + SHORT HISTORY + USER_TAIL).
- B/D retain single terminal length owner (USER_TAIL only) + DeepSeek style-only reminder.
- C/D remove BASE_SCENE_ENGINE_RULE + `[이번 턴 장면 지시]` only — no replacement progression text.
