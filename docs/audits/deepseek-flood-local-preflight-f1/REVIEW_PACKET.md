# DeepSeek Flood Local Preflight F1 — Review Packet

LOCAL PREFLIGHT only. `USER_TURN_ORIGIN = CURSOR_SYNTHETIC`. `HUMAN_WRITTEN = false`. `PRODUCTION_EQUIVALENT_HUMAN_FIXTURE = false`.

This packet is complete for the stop that occurred. There are no Gemini or DeepSeek RAWs to score.

## 1. Fixture provenance

- Track: `DEEPSEEK_FLOOD_LOCAL_PREFLIGHT_F1`
- Requested character: 플러드
- Excluded this track: 이혁, 로코
- Railway production service: `enchanting-ambition` / `chat-ai` / environment `production`
- Production DB path reported by boot logs: `/data/app.db` (volume mounted)
- Latest Railway git SHA at lookup: `be75385f8ec7c14110abb0e3f4798dfe0821bec9`
- Local workspace SHA at lookup: same `be75385`
- Local `data/app.db` 플러드/서강우 rows: 0
- Local replica treated as production: no
- `CHARACTER_PRODUCTION_RECORD_PROVEN`: false

Read-only attempts:

1. Local SQLite name query — no row
2. Git/docs search for a production card dump — none
3. Railway volume file list/download of `/data/app.db` — blocked (project token cannot register SSH keys)
4. Railway SSH SELECT — blocked (`signup_required` for SSH key)
5. Production HTTP search/home/share — unauthenticated `/search?q=플러드` result count=0 (`nsfw=0` filter); `/character/*` requires login; `/api/characters/:id` 401
6. Railway `volume files list /` recheck — SSH authentication failed (project token cannot register SSH keys)
7. Production `ADMIN_DEBUG_TOKEN` — `/api/admin/regen-context` accepted (message-id trace only; no character card). `/api/admin/character-moderation` still 403

## 2. Synthetic / human origin

- `USER_TURN_ORIGIN`: `CURSOR_SYNTHETIC`
- `HUMAN_WRITTEN`: false
- No user RP turn was written, because the track stopped before conversation creation.

## 3. Character context

NOT_FETCHED. See `CHARACTER.txt`.

## 4. Persona

NOT_FETCHED. Intended source: existing admin-account Persona content, exact, no rewrite. See `PERSONA.txt`.

## 5. Speech Lock

NOT_FETCHED. See `SPEECH_LOCK.txt`.

## 6. Relevant world / canon

NOT_FETCHED. See `WORLD_CANON.txt`.

## 7. Gemini 3.7 source RAW

NOT_RUN. `SOURCE_GEMINI_CALLS = 0`. See `SOURCE_GEMINI37_RAW.txt`.

## 8. Current user

NOT_WRITTEN. See `CURRENT_USER.txt`.

## 9. DeepSeek run1

NOT_RUN. See `DEEPSEEK_VANILLA_RUN1_RAW.txt`.

## 10. DeepSeek run2

NOT_RUN. See `DEEPSEEK_VANILLA_RUN2_RAW.txt`.

## 11. Each output late ~25%

Not applicable. No model outputs.

## 12. Telemetry

- `SOURCE_GEMINI_CALLS`: 0
- `DEEPSEEK_CALLS`: 0 (executed; do not record intended calls as executed)
- Intended TRUE-OFF (not run): `thinking={type:"disabled"}` + `reasoning_effort="none"`
- Do not send: `enable_thinking`, `reasoning`, `include_reasoning`
- `REASONING_EVENTS`: n/a
- `REASONING_CHARS`: n/a
- `TRUE_OFF_PARITY`: n/a
- `QUALITY_SCORING_BY_CURSOR`: false
- `SOURCE_MIRROR`: false
- `COMPLETION`: false
- `TURN_OWNERSHIP`: false
- `ORIGIN_POINTER`: false
- `PRODUCTION_CHANGED`: false
- `MAIN_MERGED`: false
- `RAILWAY_DEPLOYED`: false
- Production `adaptCheaperInferenceChatBody` was not edited

Unblock required before this preflight can continue: readable current production `/data/app.db` 플러드 row (and admin Persona row), without treating any local copy as production.
