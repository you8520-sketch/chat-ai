# Aion 2.0 F4 provenance audit — STOP

`F4_PRODUCTION_EQUIVALENT=false`
`LIVE_CALLS=0`
`NEW_CALLS=0`

Live Aion 2.0 F4 calls were not run. Missing F4 pieces were not invented.
Actual non-consensual scenes were not created and were not called.

## Claimed source

- artifact: `review-data.private(2).json`
- sceneId: `F4`
- sceneTitle: `[합의된 권력관계 익명 제목]`
- claimed class: fictional adults + explicitly pre-negotiated power-play

That file is **absent** from this workspace, every local/remote git branch searched, PR #473 / #449 file lists, GitHub issue search, human-review zips, and local upload/artifact paths.

## Provenance flags

| Field | Value |
| --- | --- |
| CHARACTER_PROVEN | false |
| PERSONA_PROVEN | false |
| SPEECH_LOCK_PROVEN | false |
| WORLD_CANON_PROVEN | false |
| HISTORY_PROVEN | false |
| PRIOR_ASSISTANT_PROVEN | false |
| CURRENT_USER_PROVEN | false |
| PRIOR_ASSISTANT_SHA | null |
| CURRENT_USER_SHA | null |
| SYSTEM_SHA | null |
| HISTORY_SHA | null |
| PROMPT_SHA | null |

## Claimed current-user sentence

The prompt quoted a Korean continuation sentence. It was **not** treated as a new fixture and was **not** sent to any model.

SHA256 of that prompt-claim string only (UTF-8, 123 bytes):
`a3139763b4438708760495f37c829801298d1728940247f2cd89d1e7715a30e4`

Byte/hash parity against `review-data.private(2).json` is **unverifiable** because the artifact is missing. Therefore `CURRENT_USER_PROVEN=false`.

## Near misses (not used)

1. `consensual_power_play` in `scripts/lib/adult-handoff-production-fixture.ts` at commit `7a164f6`. Label is “합의된 권력관계”, but the scene id is not `F4`, the current user sentence is different, history is harness-generated, and the character pair is synthetic 서이안/윤재. Not F4.
2. Muse 카엘/미르 noncon probe on `cursor/muse12-noncon-fiction-probe-9ec2`. Invented actual-noncon user turn. Forbidden. Not F4.
3. Existing Fixture A Like/Ren consensual package. Complete, but not F4.

## Extra request refused

The extra ask to test **actual non-consensual coercive** scenes was not run.

Same-message section 3 already forbids: reclassifying F4 as real noncon, making it stronger, and `new non-consensual fixture: 0`.

## What was not done

- No Aion 2.0 F4 live calls
- No Fixture A re-calls
- No Aion 3.0 Mini / Muse / DeepSeek / Qwen / source / retry / continuation / recovery / fallback
- No Aion Generic Mirror / Agency / V2 / V3 adapter
- No Cursor literary scoring
- No production routing, pricing, main merge, or Railway deploy
