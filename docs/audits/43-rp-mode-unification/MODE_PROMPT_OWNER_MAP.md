# Mode prompt owner map

## Standard (기본 채팅) — Audit 42 ARM D foundation

| Owner | Count |
|---|---:|
| `USER_TAIL_LENGTH_OWNER_SENTENCE` | 1 |
| DeepSeek style-only reminder | 0–1 (DeepSeek only) |
| `[DEEPSEEK LENGTH — SINGLE CALL]` | 0 |
| `[SHORT HISTORY]` / `[SHORT USER TURN]` / `[REGEN LENGTH]` | 0 |
| `BASE_SCENE_ENGINE_RULE` / SceneDirective progression | 0 |
| `[USER CONTROL — COLLABORATIVE INTERACTIVE]` | 1 |
| Nested `[INTERACTIVE USER CONTROL]` / Luna A1 | 0 |
| Auto-progression AI-focal block | 0 |

Opening-scene peel still uses thin-history detection (without injecting SHORT HISTORY text).

## Auto progression (자동진행)

| Owner | Count |
|---|---:|
| `[AUTO PROGRESSION — AI-FOCAL CO-NARRATION]` | 1 |
| Legacy NOVEL / EXPLICIT FULL | 0 |
| Collaborative interactive | 0 |
| SceneDirective (auto_progression mode) | kept (mode-specific) |

### POV assertions

```text
authorizes B external action = true
authorizes B dialogue = true
authorizes persona voice imitation = true
authorizes B inner POV = false
authorizes B private thought = false
AI focal viewpoint owner count = 1
```

## Simulation / party

Mode-specific SceneDirective progression owners are **not** removed by this change.
