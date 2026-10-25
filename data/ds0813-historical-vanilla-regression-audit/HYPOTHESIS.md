# Hypothesis — not proven

DeepSeek 0813 strongly uses recent assistant length/density as an implicit response-length exemplar.

Historical observations only:

- PR #493: recent Gemini assistants 2534 / 2630 / 3517 → Vanilla 3356 / 3747
- PR #455 Opus-source true-zero-reasoning → 3721 / 4136 / 3884
- PR #555 thin history → 1625–2333

`HYPOTHESIS_PROVEN=false`

The two-call isolation (H_THIN vs H_LONG, same system and current user) did not run because the exact #493 long-history chain and assembled system are not restorable.
