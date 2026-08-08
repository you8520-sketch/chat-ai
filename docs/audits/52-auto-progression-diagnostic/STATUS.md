# Auto-progression diagnostic (PR B)

```text
AUTO_PROGRESSION_NOT_PRODUCTION_READY
AUTO_PROGRESSION_CO_NARRATION_HARD_FAIL
AUTO_OWNER_PLACEMENT_PASS
MODEL_FAILED_EXPLICIT_CO_NARRATION_REQUIREMENT
DEEPSEEK_AUTO_PROGRESSION_NOT_RELIABLE
```

## Scope

Diagnostic-only branch stacked on the standard collaborative lineup candidate.

Includes:

- positive-execution paragraph experiment on `[AUTO PROGRESSION — AI-FOCAL CO-NARRATION]`
- Audit 45 live + revalidation human verdict
- Audit 50 owner-placement audit (Result B — no later conflicting owner)
- auto-progression diagnostic scripts and human-review zip

## Rules

- Do **not** merge for production.
- Do **not** perform a third prompt wording revision.
- Later product architecture options A–D are recorded in Audit 50 README only; none are implemented here.

## Stack

```text
base = cursor/standard-collaborative-lineup-6a91 (PR A)
head = cursor/auto-progression-diagnostic-6a91 (this branch)
```
