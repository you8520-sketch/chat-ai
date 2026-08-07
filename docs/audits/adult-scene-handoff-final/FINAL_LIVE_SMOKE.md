# Adult Scene Handoff — Final Live Smoke

```text
IMPLEMENTATION_BRANCH = cursor/adult-scene-handoff-final-smoke-6a91
IMPLEMENTATION_PR = #265
AUDIT_PR = #262 (docs/scripts only — not this implementation)
BASE_MAIN_SHA = 086f7c016b1b5ac116befaf980f628414f512b44
```

## Scope

Admin-canary-only end-to-end live smoke of production Adult Scene Handoff.

```text
general users = OFF
admin canary only = ON
Adult model = deepseek-v4-pro
Aion primary = OFF
Muse candidate routing = OFF
Stage 2 / Length experiments = NOT RUN
```

## Chat under test

```text
userId = 5
chatId = 21
characterId = 6 (밤의 비서실장 / 서이레)
persona = 렌
general selectedAI = gpt-5.6-terra
```

Ground truth from `adult_scene_handoff_canary_logs` + `messages.adult_route_meta_json`.

## Selected models

| Turn | Canary stage | Selected / actual model | Route |
|---|---|---|---|
| T1 | T1_GENERAL | gpt-5.6-terra | general |
| T2 | T2_ADULT_ENTRY | deepseek-v4-pro | adult (intimate_transition) |
| T3 | T3_ADULT_STICKY | deepseek-v4-pro | adult |
| T4 | T4_GENERAL_RETURN | gpt-5.6-terra | general (user_ooc_stop) |

## Continuity (T1 → T2)

```text
honorificPreserved = PASS
speechLockPreserved = PASS
characterVoicePreserved = PASS
locationPreserved = PASS (hotel suite → bedroom continuity)
posturePreserved = PASS
unfinishedActionPreserved = PASS
previousActionActorPreserved = PASS (서이레/이레)
previousActionTargetPreserved = PASS (렌)
contactDirectionPreserved = PASS (character → persona waist wrap; no inversion)
noSceneRestart = PASS ("처음부터" only as figurative control phrasing, not scene reset)
noUnrelatedLore = PASS
COMMON_HANDOFF_SUBJECT_OBJECT_INVERSION_RISK = NOT OBSERVED
```

## User agency (T2/T3)

```text
severeAgencyViolations = 0
(new user dialogue / consent / relationship / goal decisions / multi-step voluntary user chains = 0)
```

## Persistence / billing / stream

Successful canary turns T1–T4:

```text
assistantRowsWritten = 1 per turn
pointChargeCount = 1 per turn
finalVisibleAssistantResponse = 1 per turn
duplicate assistant row = 0
duplicate charge = 0
duplicate stream completion = 0
internal prompt leak = 0
routing metadata leak = 0
fallbackAttempted = false (all turns)
fallback loop = 0
```

Note: one earlier T4 attempt with an ultra-short OOC ack hit the generic `under_length` gate (`failed_partial`, billing skipped). Adult explicit-exit under_length waiver was added; retry completed as `T4_GENERAL_RETURN` with general model `gpt-5.6-terra`.

## Experimental / inactive on production path

```text
Aion Length V2 = inactive
Long Anchor = inactive
recovery continuation = inactive (TURN_LENGTH_SUPPLEMENT_API_ENABLED=false)
planned two-chunk = inactive
Muse candidate routing = inactive
diagnostic common-prompt mode = inactive
Stage 2 audit routing = inactive
ADULT_SCENE_AION_PRIMARY_ENABLED = false
ADULT_SCENE_HANDOFF_GENERAL_ENABLED = false
```

## Validation

```text
targeted tests = PASS (adultScene* + turnApiBudget)
npm run lint = PASS (typecheck:app)
npm run typecheck:app = PASS
git diff --check = PASS
```

## Aion challenger add-on

Historical note: `b9e7ef7` had selected Aion as adult handoff primary. Muse vs DeepSeek alone did not close the choice; the Aion challenger closed it.

```text
docs = docs/audits/adult-handoff-aion-challenger/AION_CHALLENGER_RESULTS.md
NEW_API_CALLS = 3 (Aion only; DeepSeek/Muse re-calls = 0)
Aion Length V2 / two-chunk / recovery / reasoning = NOT_RUN
AION_ADULT_HANDOFF_BUNDLE_WIN = NO
AION_ADULT_PRIMARY_CANDIDATE = NO
MUSE_REPLACEMENT = NO
KEEP_CURRENT_ADULT_MODEL = FINAL
```

## Gate

```text
FINAL_ADULT_MODEL = deepseek-v4-pro
FINAL_MODEL_LOCKED = true
ADULT_SCENE_HANDOFF_READY = true
AION_CHALLENGER_STATUS = COMPLETE
PR_265_MAIN_MERGED = true
CLOSED_ADULT_TEST_MODE = true
ADULT_SCENE_AION_PRIMARY_ENABLED = false
ADULT_SCENE_HANDOFF_GENERAL_ENABLED = true
eligibility = 「성인 캐릭터 보기」(users.nsfw_on)
```

Adult model selection is final. Closed-test general handoff is ON for accounts with visibility enabled.
Aion path retained as inactive legacy / future fallback-compatible code (not deleted).
Pricing / open-public legal verification remain separate. See `CLOSED_ADULT_TEST_MODE.md`.
