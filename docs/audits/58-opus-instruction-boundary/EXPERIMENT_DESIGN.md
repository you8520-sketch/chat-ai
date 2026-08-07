# EXPERIMENT_DESIGN — Audit 58

D/E share production canon/context/history/sampling. Difference = one terminal paragraph only.

T1: cross-arm `base_prompt_hash_without_terminal` must match before API calls.
T2: each arm continues from its own T1; same-history D/E base hashes still match.

Length metric: `visibleAssistantDisplayCharCount`.

Insert location in Arm E: after allowed-assist conditions, before forbidden-action list.
