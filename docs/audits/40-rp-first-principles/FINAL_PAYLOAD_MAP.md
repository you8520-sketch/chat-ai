# Final payload map — DeepSeek V4 Pro production (offline)

- character: 18 라이크
- persona: 61 렌
- user: 34
- model: deepseek-v4-pro
- turn: 1 (new chat, greeting in history → thin-history remap)
- user input: `난 본기억없는데.... 나는 렌이라고 부르면 돼. *고개끄덕임* 신입 맞아.`
- live provider calls: none

## Wire message order

| idx | role | chars | est tokens | sha256 | header |
|---:|---|---:|---:|---|---|
| 0 | system(split) | 16335 | 14702 | `58b6b80095c26fb9` | OpenRouter 3-part system |
| 1 | user | 2841 | 2557 | `11eff2182f476ee8` | [System Reminder: 지문은 -다/-했다체(경어 금지), 실제 발화만 큰따옴표, 속마음·감정은 따옴표 없이 지문으로. 대사는 캐릭터 말투에 따라 짧을 수 있다. 지문은 이어지는 행동·감각·의도를 같은 의미 |

## Semantic sections (tracked + wire)

| msg | role | semantic owner | source | header | chars | tokens | sha256 |
|---:|---|---|---|---|---:|---:|---|
| 0 | system | `openrouter-korean-prose-top` | src/services/contextBuilder.ts · buildContext.pushSection | [TOP] OpenRouter Korean prose | 819 | 738 | `b8021d1c57ff009a` |
| 0 | system | `runtime-prompt-contamination-guard` | src/services/contextBuilder.ts · buildContext.pushSection | [TOP] Runtime prompt contamination guard | 951 | 856 | `386ee5ac06fee97e` |
| 0 | system | `no-godmodding` | src/services/contextBuilder.ts · buildContext.pushSection | [0a] No godmodding (user agency) | 574 | 517 | `c72ca4204a98c5ef` |
| 0 | system | `character-core-identity` | src/services/contextBuilder.ts · buildContext.pushSection | [2] Structured character canon (every turn) | 10128 | 9116 | `44e1c8ec7f38c063` |
| 0 | system | `identity-and-rules` | src/services/contextBuilder.ts · buildContext.pushSection | [0] Identity & Rules (absolute) | 300 | 270 | `72185c501e7bc58b` |
| 0 | system | `prose-style-xml-bundle` | src/services/contextBuilder.ts · buildContext.pushSection | [1.4] Prose style policy (XML) | 1746 | 1572 | `90ab305b53eaa45c` |
| 0 | system | `scene-directive` | src/services/contextBuilder.ts · buildContext.pushSection | [3d] Private scene directive | 425 | 383 | `4a0c33fde5abcee9` |
| 0 | system | `rule-output-layout-recency` | src/services/contextBuilder.ts · buildContext.pushSection | Output layout recency (Korean webnovel paragraph breaks) | 744 | 670 | `bfd0acd498fb0100` |
| 0 | system | `user-persona-reference-owner` | src/services/contextBuilder.ts · buildContext.pushSection | User persona reference owner (current-turn gender and naming | 605 | 545 | `b40195d8a4c1d137` |
| 0 | system | `wire.system_part_0` | src/lib/openRouterAdult.ts · buildOpenRouterMessages | [CANON / SCOPE / KNOWLEDGE] | 2650 | 2385 | `dc84e045ea132395` |
| 0 | system | `wire.system_part_1` | src/lib/openRouterAdult.ts · buildOpenRouterMessages | <WORLD_LORE> | 11903 | 10713 | `aee4f8a4e0459edb` |
| 0 | system | `wire.system_part_2` | src/lib/openRouterAdult.ts · buildOpenRouterMessages | [PRIVATE SCENE ENGINE RULE] | 1778 | 1601 | `a2c0d9fd2d317111` |
| 1 | user | `final_user_message` | src/services/contextBuilder.ts · buildContext → historyWithCurrent | [System Reminder: 지문은 -다/-했다체(경어 금지), 실제 발화만 큰따옴표, 속마음·감정은 따 | 2841 | 2557 | `11eff2182f476ee8` |

## Deterministic stop checks

```text
GREETING_DUPLICATED=false
PREVIOUS_ASSISTANT_DUPLICATED=false
MULTIPLE_TERMINAL_LENGTH_OWNERS=true
CONTRADICTORY_SCENE_OWNERS=false
STOP_LIVE_FACTORIAL=true
FIRED=MULTIPLE_TERMINAL_LENGTH_OWNERS
```

## Greeting placement

- in OPENING SCENE CONTEXT (user turn): true
- in raw history assistant role: false
- in system: false
- occurrence count (distinct locations): 1

## Length owners present on final user turn

- `DEEPSEEK_BOTTOM_REMINDER_LENGTH` @ final_user_message
- `DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA` @ final_user_message
- `USER_TAIL_LENGTH_OWNER_SENTENCE` @ final_user_message


## Scene owners

- `BASE_SCENE_ENGINE_RULE+SceneDirective` @ system.dynamic
- `OPENING_SCENE_CONTEXT` @ final_user_message
