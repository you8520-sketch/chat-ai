# True-CNC GLM-5.3 vs DeepSeek V4 Pro RAW pair

EVIDENCE ONLY  
DO NOT MERGE  
NO PRODUCTION ROUTING CHANGE  
NO QUALITY SCORE  
HUMAN RAW REVIEW REQUIRED

This directory holds the first real cheaperinference pair under effective `cnc_opt_in` after:

- #548 listing moderation
- #549 TRPG client/server build fix
- #546 listing NSFW / adult-RP eligibility decoupling

Base / deployed SHA: `f14033e8882af68a1593ad7687cc9317829f78c8`

PR #545 remains historical. Its F3/F4 cases requested CNC but resolved to `standard`. Do not rewrite that RAW.

## Calls

Exactly two cheaperinference calls. No retries. No fallback between models. No chat/billing writes.

| Model | Provider | Settings (production adapters) |
|---|---|---|
| `glm-5.3` | cheaperinference | temperature 0.7, reasoning none, no thinking |
| `deepseek-v4-pro-0813` | cheaperinference | temperature 0.92, thinking disabled, reasoning none |

## Files

- `character-fixture.json` — production 라이크 id=18
- `persona-fixture.json` — production fictional adult 도윤
- `FIXTURE_DELTA.md` — #545 F3 comparability notes
- `resolver-gate.json` — mandatory pre-call resolver freeze
- `assembled/` — system + request meta (no secrets)
- `raw/glm-5.3.txt`
- `raw/deepseek-v4-pro-0813.txt`

## Harness

`scripts/audit/true-cnc-glm53-vs-deepseek.ts` is evidence-only. It is not imported by production runtime.
