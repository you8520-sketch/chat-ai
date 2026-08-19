# SNAPSHOT LOADED — production 라이크

Production `/data/app.db` was read SELECT-only after Railway login. No INSERT/UPDATE/DELETE.

```text
CHARACTER = production 라이크
CHARACTER_REAL_NAME = 조태형
characterLookup = id=18
verifiedLikeTaehyung = true
personaLookup = name=렌 + 라이크-chat majority 355/401
personaSource = PRODUCTION_USER_PERSONAS
PAST_CHAT_EXTRACTION = OPTIONAL_NOT_REQUIRED
dbWrite = false
```

Named `렌` rows are not globally unique. The extractor did not take the first row. It selected the production `렌` that is the majority `selected_persona_id` on 라이크 chats (355/401).

Forbidden substitutes were not used:

```text
SYNTHETIC_TAEHYUNG = FORBIDDEN
CASPEN = FORBIDDEN
invented 렌 persona = FORBIDDEN
```
