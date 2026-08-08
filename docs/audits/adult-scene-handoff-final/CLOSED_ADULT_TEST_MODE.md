# CLOSED_ADULT_TEST_MODE — Adult Scene Handoff

```text
mode = CLOSED_ADULT_TEST_MODE
FINAL_ADULT_MODEL = deepseek-v4-pro
FINAL_MODEL_LOCKED = true
AION_PRIMARY = false
```

## What this is

Closed adult test cohort activation of Adult Scene Handoff for general test accounts.

This is **not** a permanent legal age-verification product. Participants are restricted to adults by operational premise; the site does not yet run a separate adult-verification system in this phase.

## Eligibility gate (current)

Reuse the existing user preference:

```text
「성인 캐릭터 보기」 = users.nsfw_on
```

| Preference | Adult handoff |
|---|---|
| ON | eligible (still requires character NSFW + scene classifier entry) |
| OFF | **not** eligible — no DeepSeek adult model substitution |

Central function only:

```text
resolveAdultEligibility()  (src/lib/adultSceneRouting.ts)
```

Do not scatter `if (nsfw_on)` checks across the chat stack.

## Routing (unchanged)

```text
general scene → selected general RP model
adult entry   → deepseek-v4-pro
adult sticky  → deepseek-v4-pro
adult exit    → original general RP model
```

Visibility ON alone never forces DeepSeek; scene classifier + character adult route conditions still apply.

## Runtime env (test deployment)

```text
ADULT_SCENE_ROUTING_ENABLED=true
ADULT_SCENE_HANDOFF_GENERAL_ENABLED=true
ADULT_SCENE_AION_PRIMARY_ENABLED=false
ADULT_MODEL_ID=deepseek-v4-pro
ADULT_SCENE_GLM_HARD_FAILURE_FALLBACK_ENABLED=true
```

Admin canary allowlists are optional diagnostics; general test users do not need canary registration when `GENERAL_ENABLED=true`.

## Future public service

Before open public launch, replace/extend the gate inside the same central function to:

```text
verified adult status
AND
adult content visibility ON
```

No separate verification UI/DB is added in this closed-test activation.
