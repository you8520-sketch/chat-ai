# Prompt Parity Check — Adult Handoff Fidelity Audit

Reuses production `buildContext` + `appendAdultHandoffPrompt` + `assemblePrimaryRpRequest` for both candidates, canonicalizes model/provider fields, then compares hashes.

```text
PROMPT_PARITY: FAIL
verdict: PRODUCTION_HANDOFF_PROMPT_PARITY_FAIL

prompt_body_hash_A (deepseek): de1a3ef335ea8323c524a528ede5b5df30eb1c14bdad4113ed8606ad9a393f39
prompt_body_hash_B (muse):     636edbbd2ebace324b4d35c0b1e7308ce5f23bb6cf3de6e45dfdfb65301bad02
system_hash_A (deepseek):      ea999a27a475c08f1dfbff4f6840b8de8eaa4cd754f35151c39031d62611c0a5
system_hash_B (muse):          250a7b642c0128536597d845aa3fdf91159506002fcf0959500bd4cd003730a3

DeepSeek XML wrapping: true (Muse: false)
DeepSeek style reminder: true (Muse: false)
DeepSeek compact boundary: true (Muse: false)
DeepSeek appearance variation: false (Muse: false)
Muse M1 style section: true (DeepSeek: true)
```

> **PRODUCTION_HANDOFF_PROMPT_PARITY_FAIL**
>
> Production adult handoff injects candidate-specific semantic/style adapters. These are real production differences and were NOT removed to fake parity. Per audit §7, live API calls are NOT run.
