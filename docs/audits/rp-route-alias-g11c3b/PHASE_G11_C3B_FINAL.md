PHASE_G11_C3B_FINAL:
pr_base_sha: 7f0c54b60e7ace11bc6e4eea9c820caadde24853
experiment_reference_base_sha: 1ecdf8f37a783b373c24f8cfdf9010ee4eff15b1
frozen_payload_hash_parity: PASS
branch: cursor/route-model-alias-bundle-g11c3b-96c2
draft PR: https://github.com/you8520-sketch/chat-ai/pull/302
sole variable: ROUTE_MODEL_ALIAS_BUNDLE
reference OR:
route: OpenRouter (stored G11-C1 Arm A — no new OR calls)
model: google/gemini-3.1-pro-preview
providers: Google / Google AI Studio (C1 observed mix)
calls reused: 6
  B: 2789 / 1933
  D: 2057 / 2798
  F: 1631 / 1862
  mean: 2178
  median: 1995
  <2000: 3/6
candidate CI:
route: CheaperInference https://api.cheaperinference.com/v1/chat/completions
model: gemini-3.1-pro-preview
providers: NOT_RUN
new calls: 0
message hash parity: PASS
  B/D/F frozen messages vs C3A Arm A snapshots: PASS (rechecked; no rebuild)
parameter parity:
temperature: 0.95 both (prepared)
top_p: omitted both
stop: omitted both
max_tokens: omitted both
reasoning: OR reasoning:{effort:low}+include_reasoning:false → CI reasoning_effort=low (SCHEMA_DIFFERENCE; semantic low)
schema differences:
  model slug google/ vs bare
  reasoning object vs reasoning_effort
  endpoint OpenRouter vs CheaperInference
B:
OR chars: 2789 / 1933
CI chars: NOT_RUN
OR mean: 2361
CI mean: NOT_RUN
quality: NOT_RUN
D:
OR chars: 2057 / 2798
CI chars: NOT_RUN
OR mean: 2428
CI mean: NOT_RUN
quality: NOT_RUN
F:
OR chars: 1631 / 1862
CI chars: NOT_RUN
OR mean: 1747
CI mean: NOT_RUN
quality: NOT_RUN
OR overall:
mean: 2178
median: 1995
<2000: 3/6
CI overall:
mean: NOT_RUN
median: NOT_RUN
<2000: NOT_RUN
>3000: NOT_RUN
>4000: NOT_RUN
>5000: NOT_RUN
max: NOT_RUN
delta:
absolute: NOT_RUN
percent: NOT_RUN
CI narration share: NOT_RUN
CI speech blocks: NOT_RUN
CI repetition: NOT_RUN
CI canon padding: NOT_RUN
CI agency severe: NOT_RUN
finish reasons:
OR: stop (C1)
CI: NOT_RUN
cost/latency observation: NOT_RUN
classification: LIVE_BLOCKED_MISSING_CHEAPER_INFERENCE_API_KEY
next: INJECT_CI_KEY_THEN_RERUN_LIVE
production wire: NOT_RUN
merge: NOT_RUN
new LLM calls: 0
ONE TURN = ONE PRIMARY LLM CALL
ci_key_recheck: present=NO len=0 injected_secrets=OPENROUTER_API_KEY_only
STOP.
