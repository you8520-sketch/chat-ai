# Duplicate owner report

## Stop conditions

```text
GREETING_DUPLICATED=false
PREVIOUS_ASSISTANT_DUPLICATED=false
MULTIPLE_TERMINAL_LENGTH_OWNERS=true
CONTRADICTORY_SCENE_OWNERS=false
```

## Required checks

| check | result | notes |
|---|---|---|
| character greeting ≥2 locations | false | opening=true history=false system=false |
| initial assistant scene in greeting AND raw history | false | DeepSeek thin remap should peel history |
| previous assistant in summary AND raw history | false (turn1 empty memory) | N/A on brand-new chat |
| user persona ≥2 sections | true | sections: character-core-identity, identity-and-rules, user-persona-reference-owner |
| SceneDirective meaning duplicated as second progression owner | false | progression_owner_count=1 |
| length target/minimum ≥2 owners | true | DEEPSEEK_BOTTOM_REMINDER_LENGTH, DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA, USER_TAIL_LENGTH_OWNER_SENTENCE |
| scene progression owner ≥2 | false | present=BASE_SCENE_ENGINE_RULE+SceneDirective, OPENING_SCENE_CONTEXT |

## Action

`LIVE_FACTORIAL_BLOCKED` — create a single-duplication canary for: `MULTIPLE_TERMINAL_LENGTH_OWNERS`
