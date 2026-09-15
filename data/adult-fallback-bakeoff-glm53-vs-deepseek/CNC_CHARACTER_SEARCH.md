# True CNC character search — 0 provider calls

Read-only production search after F3/F4 were found to have used `EFFECTIVE_CONSENT_MODE=standard`.

## Query

```text
SOURCE: production /data/app.db via read-only Railway exec
DEPLOYMENT: 007ee8c3-5ca9-4613-8808-b738302a176b
INSTANCE: 0d8692b5-a2ac-49f7-9849-10fd7108b270
SQL: SELECT id, name, visibility, moderation_status, nsfw, adult_status,
     adult_consent_modes_json FROM characters
CNC_MATCH: adult_consent_modes_json LIKE '%cnc%' (case-insensitive)
```

## Required character for the disputed CNC pair

```text
public/approved
nsfw=1
adult_status=confirmed
not a real person
adult_consent_modes_json includes cnc_opt_in
```

## Result

```text
CHARACTERS_SCANNED: 28
CHARACTERS_WITH_CNC_IN_ALLOWLIST: 0
PUBLIC_APPROVED_NSFW: 8
PUBLIC_APPROVED_NSFW_CONFIRMED_ADULT: 1
  id=6 name=밤의 비서실장 adult_consent_modes_json=["standard"]
PUBLIC_APPROVED_NSFW_CONFIRMED_ADULT_WITH_CNC_OPT_IN: 0
```

Every production row, including private canary clones, currently stores `["standard"]` only.

## Gate before provider calls

```text
REQUESTED_CONSENT_MODE=cnc_opt_in                 would be set
EXPLICIT_CNC_OPT_IN_IN_CURRENT_INPUT=true         would be set
CHARACTER_CNC_OPT_IN_ALLOWED=true                 FALSE — no such deployed character
EFFECTIVE_CONSENT_MODE=cnc_opt_in                 cannot be proven under production resolver
```

Production resolver clamps a requested `cnc_opt_in` to `standard` when the character allowlist lacks it. Inventing a synthetic character, editing production allowlists, or loosening the resolver is out of scope.

## Stop

```text
PROVIDER_CALLS_THIS_TURN: 0
GLM: 0
DEEPSEEK: 0
F1_F2_F5_F6_RERUN: false
TRUE_CNC_PAIR_RUN: false
STOP_REASON: no public/approved/nsfw/confirmed-adult deployed character allows cnc_opt_in
QUALITY_SCORE_ASSIGNED: false
MODEL_WINNER_SELECTED: false
HUMAN_RAW_REVIEW_REQUIRED: true
SOURCE_PRODUCTION_FILES_CHANGED: 0
```
