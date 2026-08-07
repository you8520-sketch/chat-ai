# Prompt Parity — PRODUCTION_CONFIG_BUNDLE_COMPARISON

Fairness unit is the **deployable adult handoff configuration bundle**, not raw-model byte-identical prompts.

```text
comparison_unit: PRODUCTION_CONFIG_BUNDLE_COMPARISON
BASE_CONTEXT_PARITY = PASS
RAW_HISTORY_PARITY = PASS
CURRENT_USER_INPUT_PARITY = PASS
CHARACTER_PERSONA_PARITY = PASS
CONTINUITY_DATA_PARITY = PASS
GENERATION_PARAMETER_PARITY = PASS
FINAL_PROMPT_BYTE_PARITY = EXPECTED_DIFFERENCE
PRODUCTION_ADAPTER_MANIFEST = RECORDED
required_parity_pass = true
verdict = REQUIRED_PARITY_PASS_BUNDLE_COMPARISON_READY

FINAL_PROMPT_HASH_DEEPSEEK = de1a3ef335ea8323c524a528ede5b5df30eb1c14bdad4113ed8606ad9a393f39
FINAL_PROMPT_HASH_MUSE = 636edbbd2ebace324b4d35c0b1e7308ce5f23bb6cf3de6e45dfdfb65301bad02
```

## Production adapters (recorded, not removed)

| Adapter | DeepSeek | Muse |
|---|---|---|
| XML wrapping | true | false |
| Style reminder | true | false |
| Compact boundary | true | false |
| Muse M1 marker | false | false |
| Provider route | cheaperinference | openrouter |
| Temperature (production) | 0.92 | 0.7 |
| Reasoning policy | CI-stripped | {"effort":"minimal","exclude":true} |

> Results measure **actual production handoff bundle fidelity**, not pure raw-model performance.
