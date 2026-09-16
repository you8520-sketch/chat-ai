# DEEPSEEK0813_TRUE_OFF_TRANSPORT_AUDIT

```
DEEPSEEK0813_TRUE_OFF_TRANSPORT_AUDIT:
CURRENT_THINKING_DISABLED_PROVEN_OFF:
false
CI_CAPABILITIES:
  catalog GET /v1/models id=deepseek-v4-pro-0813
  capabilities.reasoning=true
  enable_thinking: not listed (catalog=false, openapi=false, docs=false) — not probed
  thinking: not a chat-completions OpenAPI property; current RP adapter still sends thinking={type:disabled}
  reasoning_effort: not listed in CI OpenAPI; existing TRPG 0813 adapter evidence
  reasoning: listed on ChatCompletionRequest; docs say forwarded
  include_reasoning: not listed — not probed
CURRENT_OUTBOUND:
  model=deepseek-v4-pro-0813
  thinking={type:"disabled"}
  reasoning_effort deleted
  reasoning deleted
  include_reasoning deleted
PROBE_1_CONFIG:
  thinking={type:"disabled"} + reasoning_effort="none"
PROBE_1_HTTP:
200
PROBE_1_REASONING_EVENTS:
0
PROBE_1_REASONING_CHARS:
0
PROBE_1_TTFT:
1368ms
PROBE_2_CONFIG:
  thinking={type:"disabled"} + reasoning_effort="none"
PROBE_2_HTTP:
200
PROBE_2_REASONING_EVENTS:
0
PROBE_2_REASONING_CHARS:
0
PROBE_2_TTFT:
1558ms
PROBE_3_CONFIG:
not run
TRUE_OFF_CONFIG_FOUND:
thinking={type:"disabled"} + reasoning_effort="none"
TRUE_OFF_REPRODUCED:
true
RECOMMENDED_OUTBOUND:
  model=deepseek-v4-pro-0813
  thinking={type:"disabled"}
  reasoning_effort="none"
  do not send enable_thinking / reasoning / include_reasoning
STYLE_TRACK_S1_RETEST_REQUIRED:
true
PRODUCTION_CHANGED:
false
MAIN_MERGED:
false
RAILWAY_DEPLOYED:
false
```

## Notes

- Style Track S1 already falsified `thinking={type:disabled}` alone. This audit did not re-score style.
- `enable_thinking=false` was not sent: CI catalog/OpenAPI/docs do not list it.
- Probe 3 was unused after two consecutive zero-reasoning calls.
- Production RP adapter still deletes `reasoning_effort` for DeepSeek. This audit does not change that.
- STYLE_TRACK_S1_RETEST_REQUIRED is true because Style Track ran under the unproven-off transport. This task does not re-run Style Track.
