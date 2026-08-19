# H1-SOURCE REPLACEMENT CAPTURE R1

`GEMINI_SOURCE_READY=true`  
`REPLACEMENT_CAPTURE_CALLS=1`  
`DEEPSEEK_CALLS=0`  
`REPEATED_UPSTREAM_STREAM_FAILURE=false`

One replacement Gemini 3.7 Flash capture after the invalid `cr_mszh62oh_e2gs51ql` upstream premature EOF. Not a quality regen loop. Failed sample artifacts preserved.

---

## 0. Frozen failed sample (unchanged)

```text
FAILED_CALL_ID = cr_mszh62oh_e2gs51ql
FAILED_PROMPT_HASH = 1e440802
FAILED_VISIBLE_CHARS = 200
FAILED_OUTPUT_TOKENS = 180
FAILED_FINISH_REASON = (none)
FAILED_ROOT_CAUSE = UPSTREAM_STREAM_PREMATURE_EOF
FAILED_ARTIFACTS = H1_GEMINI_ABRUPT_CUT_AUDIT.md, MODEL_STREAM_RAW.txt, DB_STORED_ASSISTANT_RAW.txt, ...
```

Message 7 in DB was overwritten by R1; failed 200-char text remains in audit files above.

---

## 1. Human input reused exactly

DB message 6 (authoritative; not spacing-normalized):

```text
*일단일어나서 바지에 먼지를 턴다* 음 ... 아마 맞지않을까?? 나 가이드라고 했던거 같구. 별로 안아프니까 진료실은 안가도 될거같아 근데 지원국이라는곳이 어딘지 모르겠네
```

```text
HUMAN_INPUT_CHARS = 96
HUMAN_INPUT_SHA256 = d85b352c487f91bd6424adb9a1e3115ecf3db2683b6dda68f5e99cca1ec1c058
HUMAN_INPUT_REUSED_EXACTLY = true
```

(User paste without spaces differs; DB bytes are what was sent on the failed call and replayed via regenerate parent user message 6.)

---

## 2. Fixture / policy

```text
FIXTURE_CHANGED = false
PROMPT_CHANGED = false          (no manual fixture/canon/length/max_tokens edits)
MAX_TOKENS_CHANGED = false      (omitted — provider default, both calls)
REGENERATE_API_WRAPPER = true   (automatic [REGENERATE] divergence block; not a manual prompt edit)
targetResponseChars = 3200      (unchanged)
STATUS_WIDGET_EXPECTED = false
```

---

## 3. Pre-call diagnostics (local audit)

Captured in `R1_PREFLIGHT_REQUEST.json` before POST:

```text
REQUEST_TIMESTAMP = 2026-08-19T02:52:43.069Z
CLIENT_REQUEST_ID = h1_r1_mszhxtj1_itmqsv
REQUEST_BODY_SHA256 = 1d8466dbfc4d605d0b7613316947324946918af77d7e858a9bc0695d4056066b
PREFLIGHT_PROMPT_HASH_PREFIX = 1bc913b5
SELECTED_MODEL = gemini-3.7-flash
TARGET_PROVIDER = cheaperinference
max_tokens = omitted (null)
stream = true
```

Redacted structural request dump: `R1_PREFLIGHT_REQUEST.json` → `requestBodyRedacted`.

Live call (server logs / DB):

```text
LIVE_PROMPT_HASH_PREFIX = d7ab0893
ASSEMBLED_INPUT_TOKENS = 20973
temperature (live) = 1
```

Preflight SHA is from script assembly pre-POST; live hash differs because full route injects regen wrapper + runtime blocks. Use `d7ab0893` + `20973` as live SoT.

---

## 4. Transport telemetry (replacement call)

```text
HTTP_STATUS = 200
POST /api/chat = 200 in 41635ms
DELIVERED_MODEL = gemini-3.7-flash
DELIVERED_PROVIDER = cheaperinference
PROVIDER_REQUEST_ID = not logged
FINISH_REASON = stop
[OPENROUTER STREAM END] finishReason = stop
[OPENROUTER STREAM END] outputChars = 4367
STREAM_EOF_NORMAL = true
STREAM_ERROR = false
REQUEST_ABORTED = false
interrupted = false
finalized = true
chars_lost_in_sanitize = 0
```

Provider SSE event counts were not persisted (`DEBUG_STREAM` off). App SSE:

```text
APP_SSE_TOTAL_STREAM_EVENTS = 112
APP_SSE_CONTENT_EVENTS = 0        (app uses replace/instant, not delta)
USAGE_EVENT_PRESENT = true        (done.usage)
DONE_EVENT_PRESENT = true
```

Layer parity:

```text
MODEL_RAW_CHARS / SERVER_ACCUMULATED = 4367
FINAL_VISIBLE_CHARS = 4367
DB_STORED_CHARS = 4367
PIPELINE_TEXT_PARITY = true
ENDS_INCOMPLETE = false
```

Tail ends with complete quoted dialogue:

```text
“……성함이 어떻게 되십니까. 지원국에 인계할 때 전달할 기본 인적 사항은 알아야 합니다.”
```

---

## 5. Source metrics

```text
SOURCE_VISIBLE_CHARS = 4367
SOURCE_VISIBLE_CHARS_NO_WS = 3269
SOURCE_INPUT_TOKENS = 20973
SOURCE_OUTPUT_TOKENS = 3931
SOURCE_LATENCY_MS = 41654
SOURCE_FINISH_REASON = stop
GENERATION_ROW_ID = 3 (message_generations, message_id=7)
```

Usage stage `truncated: true` reflects `needsResponseLengthFix` heuristics (above aim 3200), not transport cut. `finish_reason=stop`, `ENDS_INCOMPLETE=false`, complete prose → **technically valid**.

---

## 6. Canonical freeze

```text
GEMINI_SOURCE_R1_RAW.txt
HUMAN_CUT_INPUT_RAW.txt   (same human input as msg 6)
CALL_ID = h1_r1_mszhxtj1_itmqsv
ASSISTANT_MESSAGE_ID = 7
USER_MESSAGE_ID = 6
```

```text
GEMINI_SOURCE_READY = true
DEEPSEEK_CALLS = 0
EXPERIMENTAL_RETRY = 0
CONTINUATION = 0
RECOVERY = 0
```

STOP. Do not begin HUMAN USER #1 yet. Return RAW + telemetry to ChatGPT.

---

## DEEPSEEK0813_GEMINI37_H1_SOURCE_R1

```text
FAILED_SOURCE_PRESERVED: true
FAILED_CALL_ID: cr_mszh62oh_e2gs51ql
FAILED_ROOT_CAUSE: UPSTREAM_STREAM_PREMATURE_EOF
HUMAN_INPUT_REUSED_EXACTLY: true
FIXTURE_CHANGED: false
PROMPT_CHANGED: false
MAX_TOKENS_CHANGED: false
REPLACEMENT_CAPTURE_CALLS: 1
REQUEST_BODY_SHA256: 1d8466dbfc4d605d0b7613316947324946918af77d7e858a9bc0695d4056066b
LIVE_PROMPT_HASH_PREFIX: d7ab0893
SELECTED_MODEL: gemini-3.7-flash
DELIVERED_MODEL: gemini-3.7-flash
DELIVERED_PROVIDER: cheaperinference
HTTP_STATUS: 200
PROVIDER_REQUEST_ID: not_logged
TOTAL_STREAM_EVENTS: not_persisted (provider)
CONTENT_EVENTS: not_persisted (provider)
USAGE_EVENT_PRESENT: true (app done.usage)
DONE_EVENT_PRESENT: true
STREAM_EOF_NORMAL: true
STREAM_ERROR: false
FINISH_REASON: stop
SOURCE_VISIBLE_CHARS: 4367
SOURCE_VISIBLE_CHARS_NO_WS: 3269
SOURCE_INPUT_TOKENS: 20973
SOURCE_OUTPUT_TOKENS: 3931
SOURCE_LATENCY_MS: 41654
ENDS_INCOMPLETE: false
PIPELINE_TEXT_PARITY: true
GEMINI_SOURCE_READY: true
REPEATED_UPSTREAM_STREAM_FAILURE: false
EXPERIMENTAL_RETRY: 0
CONTINUATION: 0
RECOVERY: 0
DEEPSEEK_CALLS: 0
```
