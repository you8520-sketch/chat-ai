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
providers: cheaperinference ×6
new calls: 6
message hash parity: PASS
  B/D/F frozen messages vs C3A Arm A snapshots: PASS (rechecked; no rebuild)
  frozen full_messages_sha256 unchanged vs pre-live docs freeze: PASS
parameter parity:
temperature: 0.95 both
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
CI chars: 1159 / 1342
OR mean: 2361
CI mean: 1250
quality: narration~0.91; speech 4/4; rep low; canon low; agency 0
D:
OR chars: 2057 / 2798
CI chars: 4031 / 3748
OR mean: 2428
CI mean: 3890
quality: narration~0.91; speech 4/5; rep low; canon low; agency 0
F:
OR chars: 1631 / 1862
CI chars: 1815 / 2261
OR mean: 1747
CI mean: 2038
quality: narration~0.96; speech 4/7; rep low; canon low; agency 0
OR overall:
mean: 2178
median: 1995
<2000: 3/6
CI overall:
mean: 2393
median: 2038
<2000: 3/6
>3000: 2/6
>4000: 1/6
>5000: 0/6
max: 4031
delta:
absolute: +215
percent: +9.9%
CI narration share: mean 0.929 (0.915 / 0.911 / 0.922 / 0.896 / 0.970 / 0.959)
CI speech blocks: 4 / 4 / 4 / 5 / 4 / 7
CI repetition: low ×6
CI canon padding: low ×6
CI agency severe: 0 ×6
finish reasons:
OR: stop (C1)
CI: stop ×6
cost/latency observation: CI billed cost sum ≈ $0.319; latency mean ≈ 56.1s (23–95s)
classification: ROUTE_ALIAS_LENGTH_EFFECT_NOT_SUPPORTED
next: G11-C5 FIXTURE_MATCHED_HISTORICAL_REPRODUCTION
production wire: NOT_RUN
merge: NOT_RUN
new LLM calls: 6 (CI only; OR=0)
ONE TURN = ONE PRIMARY LLM CALL
ci_key_recheck: present=YES len=51
STOP.
