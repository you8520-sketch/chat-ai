# EXPERIMENT_DESIGN — Audit 57

A/B/D share production canon/context/history/sampling. Difference = terminal owner string only.

T1: cross-arm `base_prompt_hash_without_terminal` must match before API calls.
T2: each arm continues from its own T1 (history differs by design).

Length metric: `visibleAssistantDisplayCharCount` (total display chars).

Agency evaluation uses persona-aware boundary (severe / moderate / minor). See BLIND_REVIEW.md.
