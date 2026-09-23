# PROMPT_OWNER_MATRIX — Audit 55

Pure standard collaborative baseline. No model-specific adapters.

| Owner | Value | Notes |
|---|---|---|
| SceneDirective | 0 | Not injected for standard interactive |
| collaborative owner | 1 | Hardwired COLLABORATIVE_INTERACTIVE_OWNER_BLOCK |
| legacy novel owner | 0 | Novel prose owner off |
| terminal length owner | 1 | USER_TAIL_LENGTH_OWNER_SENTENCE (non-Terra/Luna) |

Forbidden for this screen:

- model-specific adapters
- DeepSeek-only XML
- Terra-only contract
- extra length instructions
- extra style instructions
- sampling tuning beyond production wire

Reasoning (production CI wire, documented in AVAILABILITY.json):

| Model | Applied |
|---|---|
| gemini-3.1-pro-preview | reasoning_effort=low |
| claude-opus-5 | reasoning_effort unset |

End state:

```text
human review: NOT_RUN — waiting for ChatGPT
production DB apply: NO
public picker exposure: NO
pricing change: NO
auto merge: NO
auto deploy: NO
```
