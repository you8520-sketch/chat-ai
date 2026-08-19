# DeepSeek0813 ← Gemini 3.7 Flash human H1 — REVIEW PACKET

`QUALITY_SCORING_BY_CURSOR=false`  
`CURRENT_TURN_OOC_DELEGATION_TESTED=false`  
`DEEPSEEK_CALLS=0`
`GEMINI_CALLS=0`
`RAILWAY_PRODUCTION_USED=false`

---

## Infra (separate)

```text
PRODUCTION_COMMIT = b06037d
RAILWAY_PRODUCTION_USED = false
RAILWAY_501_INCIDENT = SOURCE_FETCH_BLOCKED / SEPARATE
P3_BLOCKED_UNTIL = /api/health gitCommit 213d92e
```

H1-SOURCE ran in the local test workflow only. Stale Railway `b06037d` was not used as the source environment.

## Fixture lock (existing Flood production snapshot)

Source: `data/handoff-audit-exports/handoff-17-1-2026-08-18T11-38-17-786Z/SNAPSHOT.json`  
`FLOOD_PRODUCTION_RECORD_PROVEN=true`  
`database_source=live_production`  
`snapshot_timestamp=2026-08-18T11:38:17.786Z`

```text
character.id = 17
character.name = 플러드
persona.id = 1
persona.name = 렌
CHARACTER_SHA = f1f941ab3964d8561484553ee0ebfd2ccd121cea7b367690f3d718942fe393d2
PERSONA_SHA = 019047714e494c1b1f874b8bca0fc463522a4ff83d76d6b482f7caddbee7876c
SPEECH_LOCK_SHA = a02b5b82500eba1c5d45fa2d877d31fd4ce23782c5bf8fdfcdcc19ece2188d21
WORLD_CANON_SHA = de6c8097f83027ec0d1b0d80ced2b161b02b1cf551fb5864c0b6b59b3785ae98
```

No fixture fields were edited. Speech Lock / world / memory / adult routing / max tokens / length owner / common RP prompts unchanged.

Creator-private raw (secret persona, sexual prefs) is not copied into this packet.

---

# H1-SOURCE

Local canonical Gemini 3.7 Flash source capture only. DeepSeek not called.

## Snapshot provenance

```text
SNAPSHOT_ID = handoff-17-1-2026-08-18T11-38-17-786Z
SNAPSHOT_PATH = data/handoff-audit-exports/handoff-17-1-2026-08-18T11-38-17-786Z/SNAPSHOT.json
TOP_KEYS = SNAPSHOT_ID, PRODUCTION_RECORD_PROVEN, FLOOD_PRODUCTION_RECORD_PROVEN,
           ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN, database_source, snapshot_timestamp,
           CHARACTER_SHA, PERSONA_SHA, SPEECH_LOCK_SHA, WORLD_CANON_SHA,
           loaders, character, persona, speech_lock, world_canon, prompt_relevant_config
CONVERSATION_KEYS = none
MESSAGES = none
HUMAN_AUTHORED_RP_TURNS = 0
```

The snapshot is frozen canon (character / persona / Speech Lock / world). It is not a chat transcript.

Character greeting exists in `character.fields.greeting` (`greeting_chars=580`). Greeting is **not** Gemini source and was not used as `FINAL_VISIBLE_RAW`.

## Local fixture / DB provenance

```text
LOCAL_DB = data/app.db
LOCAL_CHARACTERS = 9 seeded demo rows; id 17 / 플러드 absent
LOCAL_PERSONA_ID_1 = 데모유저  (not snapshot 렌)
LOCAL_CHATS = 1  (character_id=1, not Flood)
LOCAL_MESSAGES = 1  (role=assistant, model=greeting)
LOCAL_GEMINI_37_MESSAGES = 0
LOCAL_FIXTURE_ID / CHAT_ID = n/a
ASSISTANT_MESSAGE_ID = n/a
```

`scripts/tmp-f1-assemble-dry-run.ts` can assemble a Gemini 3.7 request against this snapshot, but its `currentUserMessage` is a **synthetic** setup line (`여기… 평가 때문에 온 거야? 나는 렌이라고 해.`). That line was not sent and is not treated as human-authored context.

`docs/audits/gemini-37-flash-baseline/` is 조태형, not Flood + 렌. Not reused.

## Existing-source search

Inspected:

- `docs/audits/deepseek0813-gemini37-human-h1/`
- `data/handoff-audit-exports/handoff-17-1-2026-08-18T11-38-17-786Z/SNAPSHOT.json`
- `data/app.db` chats / messages / message_generations
- `docs/audits/gemini-37-flash-baseline/` (excluded: wrong character)

```text
SOURCE_EXISTED_ALREADY = false
UNAMBIGUOUS_FLOOD_렌_GEMINI37_ASSISTANT = false
```

No regeneration was attempted.

## Generation gate

```text
HUMAN_AUTHORED_CONTEXT_SUFFICIENT_FOR_ONE_GEMINI_CALL = false
SYNTHETIC_USER_TURN_REQUIRED_TO_GENERATE = true
GEMINI_CALLS = 0
RETRY = 0
CONTINUATION = 0
RECOVERY = 0
```

Validity requires an actual Gemini 3.7 Flash assistant turn on Flood + 렌, ordinary MANUAL path, not greeting, not 조태형, not a Cursor-invented user setup. Capturing that now would require inventing a new HUMAN RP turn. Per H1-SOURCE: do not synthesize; stop.

## Gemini source RAW

```text
GEMINI_SOURCE_READY = false
SOURCE_NEEDS_HUMAN_SETUP = true
SOURCE_CAPTURE_INVALID = false
SELECTED_MODEL = gemini-3.7-flash (planned; not delivered)
DELIVERED_MODEL = n/a
DELIVERED_PROVIDER = n/a
MODEL_DELIVERED_RAW = (not captured)
FINAL_VISIBLE_RAW = (not captured)
SOURCE_VISIBLE_CHARS = n/a
SOURCE_VISIBLE_CHARS_NO_WS = n/a
SOURCE_INPUT_TOKENS = n/a
SOURCE_OUTPUT_TOKENS = n/a
SOURCE_LATENCY_MS = n/a
SOURCE_FINISH_REASON = n/a
ASSEMBLED_PROMPT_SHA = n/a
REQUEST_BODY_SHA = n/a
```

## Planned route (not exercised)

```text
runtimeMode = interactive
owner = [USER CONTROL — COLLABORATIVE INTERACTIVE]
source selected = gemini-3.7-flash
handoff target provider = cheaperinference
handoff target = deepseek-v4-pro-0813
TRUE-OFF = thinking { type: disabled } + reasoning_effort none
T2_ENABLED = false
T3_CREATED = false
Generic Source Mirror / Completion / Origin pointer / style adapter = OFF
current_turn_ooc_delegated = not used
Auto Progression = not used
```

---

## Cycles

### Gemini source

RAW: **WAITING** — `SOURCE_NEEDS_HUMAN_SETUP=true`

### HUMAN USER #1 → DeepSeek #1

Not run. Do not add a synthetic HUMAN USER #1.

### HUMAN USER #2 → DeepSeek #2

Not run.

### HUMAN USER #3 → DeepSeek #3

Not run.

## Locks

```text
DEEPSEEK_CALLS = 0
RETRY = 0
CONTINUATION = 0
RECOVERY = 0
FALLBACK = 0
PRODUCTION_CHANGED = false
```

## Next human action

Provide one **human-authored local setup RP turn** for Flood + 렌 on the frozen snapshot (greeting may already be in history; greeting itself is not the Gemini source).

After that setup turn exists:

1. Local Gemini 3.7 Flash call exactly once (`GEMINI_CALLS=1`, retry 0).
2. Record `FINAL_VISIBLE_RAW` + telemetry.
3. `GEMINI_SOURCE_READY=true` then STOP (still no DeepSeek).
4. Later: HUMAN USER #1 → DeepSeek #1 only.

Do not use Railway production as the source chat.
