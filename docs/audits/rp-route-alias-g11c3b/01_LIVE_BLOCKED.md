# G11-C3B LIVE BLOCKED (resume recheck)

```text
pr_base_sha: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
experiment_reference_base_sha: 1ecdf8f37a783b373c24f8cfdf9010ee4eff15b1
frozen_payload_hash_parity: PASS
message_hash_parity: PASS (B/D/F rechecked vs C3A snapshots; no rebuild)
LIVE_CALL_READY: false
new LLM calls: 0
```

## Key check (values never logged)

```text
CHEAPER_INFERENCE_API_KEY present: NO
len: 0
.env.local CHEAPER_INFERENCE_API_KEY len: 0
/tmp/ci_key: absent
CLOUD_AGENT_INJECTED_SECRET_NAMES: OPENROUTER_API_KEY only
CLOUD_AGENT_ALL_SECRET_NAMES: OPENROUTER_API_KEY only
```

`OPENROUTER_API_KEY` was **not** used as a CI substitute.

## STOP BEFORE API

Hash gate PASS, but CI key absent → no CheaperInference calls, no OpenRouter calls.
