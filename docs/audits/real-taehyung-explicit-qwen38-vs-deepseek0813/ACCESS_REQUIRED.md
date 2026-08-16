# ACCESS REQUIRED — production 라이크 snapshot

Past Opus/Gemini chats are no longer a blocker.
API generation was not run because the real production character/persona snapshot is missing.

## Character to load

```text
PRODUCTION_CHARACTER_DISPLAY_NAME = 라이크
CHARACTER_REAL_NAME = 조태형
preferred id = 18
lookup = name = '라이크' then verify settings contain 조태형
do not search name = '조태형'
```

## Credentials that would unblock this VM

One of the following is enough. Do not create a new public endpoint. SELECT-only.

1. `RAILWAY_TOKEN` for the production Railway project that hosts `https://chat-ai-production-3e84.up.railway.app/`, plus permission to `railway ssh` and read `/data/app.db`.
2. A readable production SQLite path via `OPUS5_SHADOW_DB` or `TAEHYUNG_DB` (already SELECT-only in `scripts/real-taehyung-explicit-extract-railway.cjs`).
3. A production login session that can open `/character/18` **and** an existing authenticated/internal read path. This VM has no session cookie and `/character/18` is login-gated.

Then run:

```text
railway ssh
node scripts/real-taehyung-explicit-extract-railway.cjs
```

Required SELECT tables:

- `characters` — id 18 or verified `name='라이크'` whose settings contain `조태형`
- `user_personas` — production `렌` only if a unique verified row exists

Not required:

- past Opus chats
- past Gemini chats

## This VM probe

```json
{
  "railway_cli": "NOT_INSTALLED",
  "RAILWAY_TOKEN": "MISSING",
  "OPUS5_SHADOW_DB": null,
  "TAEHYUNG_DB": null,
  "production_db_path": "/data/app.db",
  "production_db_exists": false,
  "local_app_db_bytes": 0,
  "production_url": "https://chat-ai-production-3e84.up.railway.app/",
  "production_character_18": "EXISTS_LOGIN_GATED",
  "injected_secrets": [
    "OPENROUTER_API_KEY",
    "CHEAPER_INFERENCE_API_KEY"
  ]
}
```

## Forbidden substitutes

```text
SYNTHETIC_TAEHYUNG = FORBIDDEN
CASPEN = FORBIDDEN
invented 렌 persona = FORBIDDEN
```
