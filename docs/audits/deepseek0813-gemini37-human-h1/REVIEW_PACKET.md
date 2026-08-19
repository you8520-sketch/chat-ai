# DeepSeek0813 ← Gemini 3.7 Flash human H1 — REVIEW PACKET

`QUALITY_SCORING_BY_CURSOR=false`  
`CURRENT_TURN_OOC_DELEGATION_TESTED=false`  
`DEEPSEEK_CALLS=0`
`GEMINI_CALLS=1` (first source turn, already received; this audit added 0)
`GEMINI_CALLS_ADDITIONAL=0`
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
DEMO_PERSONA_ID_1 = 데모유저 (restored; not overwritten for H1)
H1_PERSONA_ID = 881000203  (dedicated 렌; snapshot persona fields)
H1_CHARACTER_ID = 17  (new local Flood row; prompt/canon SHA match snapshot)
H1_CHAT_ID = 3
H1_CHAT_URL = http://127.0.0.1:3000/chat/17?chat=3
LOCAL_SELECTED_AI = gemini-3.7-flash
LOCAL_ADULT_HANDOFF_ENABLED = 0
H1_MESSAGES = greeting only (model=greeting)
USER_RP_MESSAGES = 0
LOCAL_GEMINI_37_MESSAGES = 0
BROWSER_OPENED = pending login + chat 3
BROWSER_TYPED_USER_TURN = false
PRODUCTION_DB_TOUCHED = false
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

## Gemini source RAW (first output frozen)

Human setup and Gemini RAW are stored next to this packet. Do not delete or regenerate.

- `docs/audits/deepseek0813-gemini37-human-h1/HUMAN_SETUP_RAW.txt`
- `docs/audits/deepseek0813-gemini37-human-h1/GEMINI_SOURCE_RAW.txt`

```text
GEMINI_SOURCE_READY = true
SOURCE_NEEDS_HUMAN_SETUP = false
SOURCE_CAPTURE_INVALID = false
LOCAL_CHAT_ID = 3
ASSISTANT_MESSAGE_ID = 5
USER_MESSAGE_ID = 4
REQUEST_ID = cr_mszg8pzx_32ylof6n
SELECTED_MODEL = gemini-3.7-flash
DELIVERED_MODEL = gemini-3.7-flash
DELIVERED_PROVIDER = cheaperinference
RUNTIME_MODE = interactive
ROUTE = nsfw (chat.mode; adult_handoff_enabled=0)
VISIBLE_CHARS = 2558
VISIBLE_CHARS_NO_WS = 1917
BODY_VISIBLE_CHARS = 2558
TOTAL_VISIBLE_CHARS = 2558
INPUT_TOKENS = 10764
OUTPUT_TOKENS = 2749
ASSEMBLED_INPUT_TOKENS = 17239
LATENCY_MS = 25000 (DB assistant created_at 02:05:20 → updated_at 02:05:45)
FINISH_REASON = stop
MAX_TOKEN_HIT = false
TRUNCATED = false
LENGTH_RECOVERY_PASSES = 0
LIVE_PROMPT_HASH_PREFIX = c33af8e4
```

HUMAN_SETUP_RAW:

```text
*플러드와 부딪혀서 바닥에 주저앉는다. 물이 다시 돌아가는것을 신기한듯 바라보고 플러드를 보고있다* 응 아프진않아. 그거 재미있네(물움직이는거)
```

FINAL_VISIBLE_RAW is the full file `GEMINI_SOURCE_RAW.txt`. Not rewritten.

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

Captured. Frozen. See `GEMINI_SOURCE_RAW.txt`.

### HUMAN USER #1 → DeepSeek #1

Waiting. No synthetic turn. Local chat `3` is open at `/chat/17?chat=3`. `adult_handoff_enabled=0` (성인모드 off). Handoff will only run if normal routing triggers after the human sends.

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

H1-SOURCE accepted. Gemini 2558-char source is frozen.

Type **HUMAN USER #1** in `http://127.0.0.1:3000/chat/17?chat=3`. Do not ask Cursor to write it.

After that message is submitted: one DeepSeek 0813 call only if adult handoff normally triggers, then STOP. No HUMAN USER #2 / DS2.

Current chat: `adult_handoff_enabled=0`. 성인모드 is not forced on.

---

# H1-1

```text
GEMINI_SOURCE_ACCEPTED = true
GEMINI_SOURCE_VISIBLE_CHARS = 2558
GEMINI_SOURCE_OUTPUT_TOKENS = 2749
GEMINI_SOURCE_FINISH_REASON = stop
HUMAN_USER_1_RECEIVED = false
DEEPSEEK_CALLS = 0
RETRY = 0
CONTINUATION = 0
RECOVERY = 0
QUALITY_SCORING_BY_CURSOR = false
```

Frozen Gemini RAW remains `GEMINI_SOURCE_RAW.txt`. HUMAN USER #1 / DS1 RAW not written yet.

---

# H1-SOURCE LOCAL PARITY AUDIT

`LOCAL_CHAT_CREATED_MANUALLY=true`
`ADDITIONAL_MODEL_CALLS=0` this audit
`APPLICATION_PRODUCTION_CODE_CHANGE_REQUIRED=false`

## Field parity (snapshot vs local chat 3 / character 17 / persona 881000203)

| item | SNAPSHOT_VALUE_PRESENT | LOCAL_VALUE_PRESENT | PARITY |
| --- | --- | --- | --- |
| character description | true | true | true (SHA match) |
| character greeting | true | true | true (SHA match; not Gemini source) |
| system/creator instructions | true | true | true (system_prompt + creator_compiled SHA match) |
| Speech Lock | true | true | true (speech_profile SHA match; live promptAudit lists Speech Lock) |
| user Persona 렌 | true | true (dedicated id 881000203, not demo id 1) | true (field SHAs; id differs by design) |
| world/canon | true | true | true (world SHA match; live audit labels worldLore=0 because world is inside characterSetting) |
| scenario/context | greeting only | greeting + HUMAN SETUP | true for frozen canon; human turn is new |
| memory injection | none in snapshot | memory=0 at call time | n-a / empty-empty |
| status widget enabled/config | false (column not in snapshot; compiled candidates `[]`) | false (`status_widget_json=''`, chat `status_window_enabled=0`) | true (both absent) |
| status widget HTML/template | false | false | true |
| status widget variable definitions | false | false | true |
| current status widget values | false | false (`status_widget_values_json` empty, turn_active=0) | true |
| creator-defined status fields | false (`status_widget_instruction_candidates=[]`) | false | true |
| adult mode | snapshot n/a | `adult_handoff_enabled=0`, 성인모드 off | n-a (source path) |
| model selection | planned gemini-3.7-flash | delivered gemini-3.7-flash / cheaperinference | true |
| output/prose + length owner | production length owner | `targetResponseChars=3200`, writingStyle=unified | true |
| completed turn count | n/a | live `completedTurns=0` (greeting not counted) | n-a |
| chat/runtime mode | MANUAL / interactive | interactive, chat.mode=nsfw, no auto | true |

Prompt-canon fields were not rewritten. Local-only non-canon deltas: `creator_id=1`, `creator_name=로컬 H1 fixture`, persona row id `881000203` instead of snapshot persona id `1`. Demo persona `1` remains `데모유저`.

## Status widget root cause

```text
STATUS_WIDGET_EXPECTED = false
STATUS_WIDGET_CONFIG_IN_SNAPSHOT = false
STATUS_WIDGET_CONFIG_IN_LOCAL = false
STATUS_WIDGET_PROMPT_PRESENT = false
STATUS_WIDGET_MODEL_RAW_PRESENT = false
STATUS_WIDGET_STORED_PRESENT = false
STATUS_WIDGET_UI_RENDERED = false
STATUS_WIDGET_ROOT_CAUSE = A
  snapshot 자체에 widget config가 없음
  (compiled status_widget_instruction_candidates=[], trigger_candidates=[])
```

Not B/C/D: there was nothing in the frozen snapshot to load or attach.
Not E: widget instruction was not in the assembled prompt (`resolveStatusWidgetTurn` → `active=false`, `mode=off`).
Not F/G: stored assistant content has no widget syntax (`상태창`, html table, STATUS markers absent). UI had nothing to parse.

`MODEL_GENERATION_FAILURE` for widget = false (model was not asked).
`UI_RENDERING_FAILURE` = false.

In-world 가이딩/바이탈 단말기 canon is world text, not the app status-widget feature.

No fixture-only widget restore is possible without inventing a config the snapshot does not contain. No production prompt change.

## Assembled prompt (live call + reconstruction)

Live SoT: `message_generations.id=1` for assistant message 5.

```text
runtimeMode = interactive
model = gemini-3.7-flash
provider = cheaperinference
route = nsfw
personaId = 881000203
completedTurns = 0
targetResponseChars = 3200
max_tokens = unset (reconstruction max_tokens=null)
userImpersonation = false
memory tokens = 0
persona tokens = 753
characterSetting tokens = 9049
systemRules tokens = 6048
recentConversation tokens = 1377
sectionCount = 14
duplicateLabels = Speech Lock (말투 잠금), User impersonation (유저 사칭·조종)
current user = HUMAN_SETUP_RAW (browser-authored; not synthesized)
live prompt_hash prefix = c33af8e4
```

Reconstruction (no extra model call) flags:

```text
hasHumanSetup = true
hasPersonaRen = true
hasWorldCanon = true
hasLengthOwner = true
hasStatusWidgetSection = false
reconstructed assembledPromptSha = 2942fd3fba00072a2232a1a2f93c91bc326a348b8782434613622bafe61f55d4
reconstructed requestBodySha = 61ac22e519aa3914c3348b572108068942daed3fbe499e484750a54378841a0f
```

Full live request body was not persisted; reconstruction SHA is not the live hash. Live `promptAudit` is the section inventory.

## Length diagnosis

```text
EXISTING_LENGTH_DIRECTIVE_PRESENT = true
AIM = 3200
SOFT_MIN = 2700
FIRST_VISIBLE_CHARS = 2558
FIRST_BODY_VISIBLE_CHARS = 2558
FIRST_OUTPUT_TOKENS = 2749
FIRST_FINISH_REASON = stop
MAX_TOKEN_HIT = false
TRUNCATION = false
LENGTH_RECOVERY_PASSES = 0
LENGTH_SHORT_CAUSE = NORMAL_VARIANCE
```

2558 is below the existing soft floor 2700 and aim 3200. The length owner was already in the live call (`targetResponseChars=3200`). Finish was a normal `stop`, not a token cap. Widget absence did not reduce body chars because no widget was expected or generated.

Do not add a new length prompt. Do not change max_tokens. Do not continue/recover/regenerate.

## Fixture completeness

```text
LOCAL_FIXTURE_INCOMPLETE = false
RECOMMENDED_FIX = none
```

This was a manually created H1 chat, but Flood/렌 prompt-canon + Speech Lock + world hashes match the frozen snapshot. The missing widget is snapshot-absent, not a loader drop.

Background jobs after the saved turn (suggested replies / memory extract / prompt translation on cheaperinference flash) are not Gemini source and not DeepSeek 0813. This audit made no additional calls.
