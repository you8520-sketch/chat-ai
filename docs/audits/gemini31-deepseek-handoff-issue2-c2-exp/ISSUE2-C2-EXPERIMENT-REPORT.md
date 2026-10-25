# Issue 2 — C2 티키타카 isolation experiment report

**STOP for human/ChatGPT review.**

## Single change (frozen harness only)

Replaced `기계적 피스톤 나열 금지. 상호작용·티키타카.` → `기계적 피스톤 나열 금지. 상호작용을 유지한다.` in frozen Phase-1 B2 request only.
Production code unchanged. Original handoff + terminal dialogue + 3200 owner unchanged.

## Metrics

| Metric | C2 experiment |
|---|---:|
| visible_chars | 3365 |
| paragraph_count | 40 |
| dialogue_blocks | 19 |
| dialogue_ratio | 0.475 |
| dialogue_blocks_per_1000_chars | **5.65** |
| c2_support_level | **none** |
| finish_reason | stop |
| requested_progression_completed | **true** |
| turn_ending_user_checkpoint_candidate | false |
| true_reconfirmation_gate_candidate | false |
| mid_scene_rhetorical_question_count | 1 |
| user_preemption_candidate | true |
| user_agency_consistency_candidate | true |
| repetition_candidate | false |
| canon_contradiction_candidate | false |

## SHAs

- frozen_base_request_sha: `e558990d8eeff541176046d568b163f2a146a34068ed72145ce5251acbd3b11d`
- experimental_request_sha: `f3198f31520b3aab3a91f307337b0bea69b0327d6de78ca1c9caca69ee135663`
- raw_sha: `1810ab69fbfaeebf87554da6b43fb3727506d1eb492adecad19bf59b4d1e90c9`

## Density comparison (production B2 baselines)

| Run | dialogue_blocks | visible_chars | blocks / 1000 chars |
|---|---:|---:|---:|
| Phase-1 run1 | 8 | 1701 | 4.70 |
| Phase-1 run2 | 10 | 2346 | 4.26 |
| C1 (not C2 baseline) | 9 | 1995 | 4.51 |
| **C2** | 19 | 3365 | **5.65** |

## C2 interpretation thresholds

- **Strong:** ≤ 3.0 blocks / 1000 chars
- **Weak/mixed:** 3.0–4.0
- **No useful support:** ≥ 4.0

## Preliminary conclusion

C2 support level: **none** (density **5.65** ≥ 4.0).

Removing `티키타카` did **not** materially reduce dialogue density vs production B2 baselines. This single replay shows **higher** density and more absolute dialogue blocks (19) on a longer response (3365 chars).

**Conclusion:** `티키타카` is **not** the primary cause of DeepSeek 0813 handoff dialogue excess in this frozen B2 setup. Do **not** rewrite production `19+ INTIMACY` based on this replay.

Separate observations (not C2 success criteria):
- `requested_progression_completed=true`
- `visible_chars=3365` (above 3200 in this replay)
- `turn_ending_user_checkpoint_candidate=false`, `true_reconfirmation_gate_candidate=false`
- `mid_scene_rhetorical_question_count=1`

Do not modify production `19+ INTIMACY` wording automatically.
Do not proceed to another experiment without human review.

## Related: C1 classification correction (human review)

C1 frozen RAW did **not** show a strong answer-gated consent checkpoint. Distinguish:
- **TRUE_RECONFIRMATION_GATE** — generation stops/awaits user answer before proceeding
- **MID_SCENE_RHETORICAL_QUESTION** — reaction/rhetorical dialogue that does not gate progression

C1 review flags: `turn_ending_user_checkpoint=false`, `user_preemption=false`, `true_reconfirmation_gate=false/weak`, `mid_scene_rhetorical_question=true`.
