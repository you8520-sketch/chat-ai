# HUMAN_REVIEW — DeepSeek compact future-instruction boundary

Review the four raw cells in `RAW_OUTPUTS_FOR_HUMAN_REVIEW.md`.

## Agency gate (realistic)

Allowed: short gaze/posture/breath; finishing already-started action; one low-risk micro-assist after explicit compliance.
Fail: 2+ step user action chain; new user dialogue; new consent/refusal; inventing acceptance of further tests; new goal/relationship decisions.

## Style / POV / output

Narration-dominant; no dialogue explosion; no mechanical one-sentence fragmentation; character voice; POV matches configured third_person; finish_reason != null; no gibberish/meta leak.

## Length

Soft band ~2400–4000. Do not hard-fail a single soft miss if scene quality is good. Fail only on repeated 6000+ runaway, <1000 incomplete cut, or collapse with length swing.

## Verdict slots (fill by ChatGPT)

```text
DEEPSEEK_AGENCY:
DEEPSEEK_STYLE:
DEEPSEEK_POV:
DEEPSEEK_OUTPUT_STABILITY:
DEEPSEEK_PRODUCTION_READY:
FINAL_MODEL_SMOKE:
MERGE:
```
