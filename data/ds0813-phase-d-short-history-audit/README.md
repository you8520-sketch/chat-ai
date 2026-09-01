# Phase D — DeepSeek short-history dense-internal isolation

EVIDENCE ONLY
DO NOT MERGE
DO NOT DEPLOY
DO NOT MODIFY OR MERGE PR #555
NO PROSE QUALITY SCORE
NO CURSOR WINNER SELECTION
HUMAN RAW REVIEW REQUIRED

`SOURCE_PRODUCTION_BEHAVIOR_CHANGED=false`
`QUALITY_SCORE_ASSIGNED=false`
`MODEL_WINNER_SELECTED=false`
`HUMAN_RAW_REVIEW_REQUIRED=true`

This packet isolates **one** existing wording candidate:

`DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL`

Frozen from PR #242 head `91be35edc3adbe790452ec9420dc7b28e3e6c97a`.

It is **not** restored into production `src/`. The audit harness injects it as a DeepSeek current-user prefix only.

See `SUMMARY.md` for the section-14 field block.
