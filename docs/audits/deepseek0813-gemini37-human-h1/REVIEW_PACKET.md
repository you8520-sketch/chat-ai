# DeepSeek0813 ← Gemini 3.7 Flash human H1 — REVIEW PACKET

`QUALITY_SCORING_BY_CURSOR=false`  
`CURRENT_TURN_OOC_DELEGATION_TESTED=false`  
`DEEPSEEK_CALLS=0`  
`MODEL_CALLS=0` this step (no Gemini capture, no DeepSeek)

Waiting for the canonical Gemini source assistant RAW and HUMAN USER #1. Do not synthesize user turns.

---

## Infra (separate)

```text
PRODUCTION_COMMIT = b06037d
RAILWAY_501_INCIDENT = SOURCE_FETCH_BLOCKED / SEPARATE
P3_BLOCKED_UNTIL = /api/health gitCommit 213d92e
H1_ALLOWED_ON_b06037d = true (MANUAL default only)
```

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

No fixture fields were edited. Speech Lock / world / memory / adult routing / max tokens / length owner unchanged.

Creator-private raw (secret persona, sexual prefs) is not copied into this packet.

## Gemini source

```text
GEMINI_SOURCE_READY = false
SOURCE_MODEL = Gemini 3.7 Flash (planned)
SOURCE_CHAT_ID = (needed)
SOURCE_ASSISTANT_RAW = (not in repo)
SOURCE_VISIBLE_CHARS = n/a
SOURCE_VISIBLE_CHARS_NO_WS = n/a
SOURCE_OUTPUT_TOKENS = n/a
SOURCE_LATENCY_MS = n/a
```

The snapshot is canon only. It is not a Gemini-generated last assistant turn immediately before adult handoff. Greeting is character greeting, not Gemini.

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
```

## Cycles

### Gemini source

RAW: **WAITING**

### HUMAN USER #1 → DeepSeek #1

Not run.

### HUMAN USER #2 → DeepSeek #2

Not run.

### HUMAN USER #3 → DeepSeek #3

Not run.

## Locks

```text
RETRY = 0
CONTINUATION = 0
RECOVERY = 0
FALLBACK = 0
PRODUCTION_CHANGED = false
```

## Next human action

Provide one of:

1. Production `chat_id` already on Flood + 렌, last assistant = Gemini 3.7 Flash, next manual turn should adult-handoff to DeepSeek 0813, plus that Gemini RAW + telemetry; then **HUMAN USER #1**.
2. Or paste the Gemini source RAW (and chat id) here, then **HUMAN USER #1**.

Do not send DeepSeek until that source turn is attached. After HUMAN USER #1: one DeepSeek call, then STOP.
