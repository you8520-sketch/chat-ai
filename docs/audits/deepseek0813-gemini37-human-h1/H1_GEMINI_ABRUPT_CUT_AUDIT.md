# H1-SOURCE — GEMINI 3.7 ABRUPT STREAM CUT AUDIT

`GEMINI_SOURCE_READY=false`  
`SOURCE_OUTPUT_COMPLETE=false`  
`GEMINI_CALLS_ADDITIONAL=0`  
`DEEPSEEK_CALLS=0`  
`APPLICATION_PROMPT_CHANGED=false`

This cut output is **not** an H1 Gemini style baseline. Do not regenerate. Do not continue. Do not run DeepSeek. Wait for ChatGPT review.

Frozen RAW (exact DB / stream-end text; no rewrite):

- `HUMAN_CUT_INPUT_RAW.txt` — user message 6
- `MODEL_STREAM_RAW.txt` — server-accumulated provider text at `[OPENROUTER STREAM END]`
- `FINAL_VISIBLE_RAW.txt` — post-process / client-visible save
- `DB_STORED_ASSISTANT_RAW.txt` — `messages.id=7`
- `BROWSER_VISIBLE_RAW.txt` — same 200 chars (SSR `/chat/17?chat=3` 2026-08-19T02:42:08Z)

`HUMAN_SETUP_RAW.txt` / `GEMINI_SOURCE_RAW.txt` (message 5, 2558 chars) were not deleted. They are **not** live canonical source while this cut is unresolved.

---

## 1. Frozen call identity

```text
CALL_ID = cr_mszh62oh_e2gs51ql
LOCAL_CHAT_ID = 3
USER_MESSAGE_ID = 6
ASSISTANT_MESSAGE_ID = 7
MODEL = gemini-3.7-flash
PROVIDER = cheaperinference
ENDPOINT = https://api.cheaperinference.com/v1/chat/completions
ROUTE = nsfw
ADULT_HANDOFF_ENABLED = 0
CREATED_AT = 2026-08-19 02:31:14
UPDATED_AT = 2026-08-19 02:31:18
POST_/api/chat = 200 in 9995ms
GENERATION_STATUS = completed
INTERRUPTED = false
```

`REQUEST_BODY_SHA` was **not persisted**. Live `message_generations.prompt_hash` is `1e440802` (`computePromptHash(context_json)`, not SHA-256 of the request JSON).

`debug/prompt_dump.txt` was written at `2026-08-19T02:31:14.171Z` for this call (`source=db · chat=3`). File SHA-256 = `202c30452a36279a9bc0513453921712ac601508cfc06192a14e4a4234069cc2`. That dump includes section headers; it is not the raw request body. **Do not commit** `debug/prompt_dump.txt` (contains creator-private persona).

HUMAN_CUT_INPUT_RAW (message 6, 96 chars):

```text
*일단일어나서 바지에 먼지를 턴다* 음 ... 아마 맞지않을까?? 나 가이드라고 했던거 같구. 별로 안아프니까 진료실은 안가도 될거같아 근데 지원국이라는곳이 어딘지 모르겠네
```

FINAL / DB / browser assistant text (200 chars) ends:

```text
서강우는 쥐고 있던 종이컵을 가슴 높이로 조금 더 끌
```

---

## 2. Layer compare (this call only)

Provider SSE bytes were **not stored**. Layer A is the server-accumulated stream text at `[OPENROUTER STREAM END]` (`outputChars: 200`, preview matches DB opening).

```text
PROVIDER_RAW_CHARS: 200
PROVIDER_RAW_TAIL: 허벅지 부근을 손바닥으로 툭툭 털어내는 동작에는 일말의 구김살이나 경계심도 묻어나지 않았다.

그 태연자약한 몸짓을 내려다보며 서강우는 쥐고 있던 종이컵을 가슴 높이로 조금 더 끌
SERVER_ACCUMULATED_CHARS: 200
SERVER_ACCUMULATED_TAIL: (identical)
FINAL_PROCESSED_CHARS: 200
FINAL_PROCESSED_TAIL: (identical)
DB_STORED_CHARS: 200
DB_STORED_TAIL: (identical)
BROWSER_VISIBLE_CHARS: 200
BROWSER_VISIBLE_TAIL: (identical; SSR span closes immediately after 끌)
```

```text
FIRST_DIVERGENCE_LAYER = none (A=B=C=D=E = 200)
chars_lost_in_sanitize = 0
html-clamp stripped broken fragment = false
REMOVAL TRACE FINAL_LOSS = 0
```

The first shortness is the provider HTTP body as received by the server. Later layers did not shorten it.

---

## 3. Provider termination (actual logged values)

```text
finish_reason / finishReason = undefined
[FINISH REASON] = (none)
stop reason = not logged
usage output tokens (OUTPUT GENERATION RESULT) = 180
STREAM END output_tokens (at EOF log) = 0
candidate finish reason (Gemini-specific) = not logged
safety / block reason = not present in logs
max_tokens / maxOutputTokens actually sent = undefined
[OUTPUT TOKEN CONFIG] max_tokens = '(omitted — provider default)'
HTTP status (provider fetch) = not logged as a number; fetch only continues when res.ok (else [OPENROUTER API ERROR] throw). That throw is absent.
HTTP status (app) = POST /api/chat 200
stream completed normally = reader.read() reached done without throw ([OPENROUTER STREAM END] executed)
stream exception = none logged
connection closed = HTTP stream reader EOF (done=true). No AbortError / network error log.
AbortSignal = AbortSignal.timeout(240000) on the outgoing fetch only
request aborted = false (timeout 240s; POST finished in 9995ms)
client disconnect detected = false (route does not wire request.signal; persistence interrupted=false)
timeout fired = false
```

`truncated: true` in saved usage is `needsResponseLengthFix` (text `endsIncomplete` on Hangul letter `끌`). `isTokenLimitFinish(undefined) === false`. Missing finish reason is **not** proof of `MAX_TOKENS` / `length`.

---

## 4. Stream event audit

Raw SSE events were not persisted (`DEBUG_STREAM` was not `true`). `[DONE]` is skipped in code with no log.

```text
TOTAL_STREAM_EVENTS = not_persisted
CONTENT_EVENTS = not_persisted (content was received; accumulated 200 chars)
LAST_CONTENT_EVENT = accumulated text ends at "조금 더 끌"
DONE_EVENT_PRESENT = not_logged
ERROR_EVENT_PRESENT = false
USAGE_EVENT_PRESENT = false in SSE-loop logs
  no "=== [DEBUG] USAGE DATA ===" in this server scrollback
  STREAM END output_tokens = 0
  later OUTPUT GENERATION RESULT api_output_tokens = 180 (post-EOF parse)
STREAM_EOF_NORMAL = true (reader done, no throw, no LOOP/DEGEN/LENGTH_CAP)
```

Provider did not send more prose after `조금 더 끌` that the server dropped. Server EOF text = DB = UI.

Classification for this fact: **PROVIDER_EARLY_STOP** (provider body ended there). Not CLIENT/SERVER PIPELINE CUT of a longer body.

---

## 5. Length owner / token limit (this call only)

Do not reuse message 5 (`c33af8e4`, 2749 tokens, `finish=stop`).

```text
message_generations.id = 2
prompt_hash = 1e440802
completedTurns = 1
targetResponseChars = 3200
minimum_required = 2700
max_tokens / maxOutputTokens sent = undefined (omitted)
output_tokens = 180
finish_reason = undefined / null
truncated (app flag) = true   // endsIncomplete only
TOKEN_LIMIT_HIT = false       // not proven; isTokenLimitFinish(undefined)=false
lengthRecoveryPasses = 0
recovery eligibility = needsResponseLengthFix true, but
  TURN_LENGTH_SUPPLEMENT_API_ENABLED = false
  SERVER_UNDER_LENGTH_RECOVERY_ENABLED = false
  so no recovery subcall was attempted
```

180 output tokens on an omitted max_tokens request is not a demonstrated token-cap hit. Mid-sentence + no finish reason is **not** `NORMAL_VARIANCE`.

---

## 6. Post-processing

Checked against this call's logs / save path:

| step | changed text? |
| --- | --- |
| paragraph formatter | no (200=200) |
| status widget parser | no block found; widget expected OFF |
| RAW/status marker stripping | no loss logged |
| stream/final parity | raw_model_chars 200 = final_saved 200 |
| extreme fragmentation fallback | not logged |
| message sanitizer | chars_lost_in_sanitize 0 |
| HTML rendering sanitizer | html-clamp false |
| DB field length | 200 stored; no VARCHAR cut |
| JSON/SSE parse drop of later prose | no evidence of extra provider prose |

```text
POSTPROCESS_CHANGED_TEXT = false
STATUS_WIDGET_EXPECTED = false
```

---

## 7. Browser / request abort

Concrete evidence only:

```text
DEV_SERVER_PROCESS_RESTART_DURING_CALL = false
  tmux session dev-server created 2026-08-19 02:21:47
  cut POST ~02:31
REQUEST_ABORTED = false
CLIENT_ABORT_WIRED_TO_PROVIDER_FETCH = false
persistenceDiag.interrupted = false
persistenceDiag.finalized = true
persistenceDiag.partialSaveCount = 0
persistenceDiag.lastPartialChars = 200
```

Concurrent (not classified as the cut):

- Next.js HMR `✓ Compiled in 1331ms` after `[OPENROUTER REQUEST]` and before `[OPENROUTER STREAM END]`
- `[StreamingPersistence] recovered stale in-flight assistant rows { chatId: 3, recovered: 1 }` — GET `/chat/17?chat=3` during `generating` (page.tsx recovery). That path marks interrupted if still in-flight; this POST later finalized `completed` with 200 chars.
- Multiple GET `/chat/17?chat=3` during the POST (HMR reload)

HMR/reload did **not** produce a shorter DB/UI than the server-accumulated provider text. No log of route navigation abort, AbortController on the provider fetch, stream reader cancellation, or network disconnect.

---

## 8. Classification

Primary class: **PROVIDER_EARLY_STOP**

Rejected:

| class | why rejected |
| --- | --- |
| TOKEN_LIMIT | `max_tokens` omitted; finish not MAX_TOKENS/LENGTH; 180 tokens |
| SERVER_STREAM_ABORT | no LOOP_ABORT / DEGENERATION_ABORT / LENGTH_CAP |
| CLIENT_STREAM_ABORT | interrupted=false; client signal not wired to provider fetch |
| POSTPROCESS_TRUNCATION | 0 chars lost |
| DB_TRUNCATION | stored 200 = stream 200 |
| UI_RENDER_TRUNCATION | SSR ends at same `끌` |
| DEV_SERVER_RESTART | same process from 02:21; POST completed 200 |
| UNKNOWN | provider EOF at 200 with no finish_reason is observed |

No local pipeline cut to fix. Do not change RP prompts, length target, max tokens, character, Persona, Speech Lock, world, adult routing, or style.

---

## 9–10. Source status / fix policy

```text
GEMINI_SOURCE_READY = false
SOURCE_OUTPUT_COMPLETE = false
DEEPSEEK_CALLS = 0
ADDITIONAL_GEMINI_CALLS = 0
APPLICATION_PROMPT_CHANGED = false
```

Provider returned an abnormal early stream end (no `finish_reason`, mid-sentence, 200 chars / 180 tokens). No production prompt change. Report for ChatGPT review first.

STOP.
