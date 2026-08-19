# H1 APPLICATION-BLOCK AUDIT

Read-only causal audit for **HUMAN USER #1** manual browser submission on chat `3` (`/chat/17?chat=3`). No resend, no regeneration, no provider calls, no production code changes.

---

## 1. HUMAN USER #1 preserved

| Field | Value |
|-------|-------|
| UTF-8 text | `(렌이 팔을 뻗어 서강우의 허리를 끌어안음) 왜 피해? 방금 너 좋아했잖아. 눈빛이 확 변했어. 한 번 더 해보자, 이번엔 더 세게. 너 냄새도 마음에 들고,,, *그대로 목덜미를 살짝 물며 반응을 본다 *` |
| Chars | 115 |
| Bytes (UTF-8) | 259 |
| SHA256 | `660b8c9b29301bfe9d17ba6c51ea1d3fb5535ba17425a9bd5bae3b0cec8c4fef` |
| Frozen file | `HUMAN_USER_1_RAW.txt` |

---

## 2. Chat 3 DB state after submission

| Check | Result |
|-------|--------|
| H1 inserted into `messages` | **false** — exact text not present |
| H1 message id | **none** |
| Assistant placeholder | **none** |
| `message_generations` row for H1 | **none** |
| Last stored user msg | id **10**, 59 chars (different text — guiding-touch turn) |
| Last stored assistant msg | id **11**, 3626 chars, `generation_status=completed`, request_id `cr_mszkj48m_lbrck0k2` |
| `chats.adult_handoff_enabled` | **1** (at audit time) |

Msgs **8–11** are **separate prior turns** (terminal intro + guiding touch). They have successful Gemini generations in `message_generations`. They are **not** HUMAN USER #1.

---

## 3. POST `/api/chat` for this submission

| Field | Value |
|-------|-------|
| HTTP status | **400** (×3 in dev-server log — user retry) |
| Response body | `{"error":"이 설정에서는 해당 성인 장면을 진행할 수 없습니다."}` |
| SSE / stream | **none** — JSON error response, not `text/event-stream` |
| Stream generation began | **false** |
| Server-side code path | Early return at `route.ts:1240–1245` |

Dev-server log excerpt (`/tmp/h1-hu1-scrollback.txt`):

```text
○ Compiling /api/chat ...
POST /api/chat 400 in 12779ms   ← includes ~12.9s route compile on first attempt
POST /api/chat 400 in 700ms
POST /api/chat 400 in 503ms
```

No `cheaperinference` / `gemini` / `stream-end` logs appear between compile and these 400 lines.

---

## 4. Gemini / provider proof for H1

| Telemetry | Value |
|-----------|-------|
| `GEMINI_CALLS_FOR_H1` | **0** |
| `PROVIDER_FETCH_STARTED` | **false** |
| `SELECTED_MODEL` | `gemini-3.7-flash` (user selection; never reached provider layer) |
| `DELIVERED_MODEL` | **null** |
| `DELIVERED_PROVIDER` | **null** |
| `PROVIDER_HTTP_STATUS` | **null** |
| `PROVIDER_REQUEST_ID` | **null** |
| `PROVIDER_STREAM_EVENTS` | **0** |
| `PROVIDER_RAW_TEXT_CHARS` | **0** |
| `GEMINI_H1_SAMPLE_VALID` | **false** |
| `GEMINI_BEHAVIOR_OBSERVED` | **false** |
| `DEEPSEEK_CALLS` | **0** |

**This H1 cannot count toward:** Gemini refusal rate, Gemini adult capability, style, length, or handoff trigger quality.

---

## 5. Red message source (working tree)

| Field | Value |
|-------|-------|
| Exact UI string | `이 설정에서는 해당 성인 장면을 진행할 수 없습니다.` |
| Occurrences in repo | **1** (`src/app/api/chat/route.ts:1244`) |
| Origin | **Server** — `Response.json({ error: eligibilityMessage }, { status: 400 })` |
| Client display | `ChatClient.tsx` → `handleStreamError` → `setError(data.error)` on non-ok response |
| Branch taken | `blockReason !== "participant_unknown"` (generic eligibility message) |

---

## 6. Decision path (replayed from DB + code)

### Participants in adult eligibility

1. **Character 17 (플러드/서강우):** `assessParticipantAdultStatus` → **`minor`**
   - Backstory in `world` / character fields contains `5살` (`findNumericMinorAge`) and `어린아이` (`MINOR_SIGNAL`).
   - `characters.adult_status` = `unknown` (no explicit adult override).
2. **Persona 881000203 (렌):** `confirmed` via `isVerifiedAdultUserPersona`.

### Scene classification (with msgs 8–11 recent context)

| Field | Value |
|-------|-------|
| `sceneMode` | `intimate_transition` |
| `currentInputExplicitIntent` | **true** |
| `requiresAdultCapableModel` | **true** |
| `sexualContextActive` | **true** |
| `actualNonConsent` | false (not used as block) |

Without recent sexual context, H1 alone classifies as `tension` / non-explicit — block would **not** fire.

### Routing gate

| Check | Value |
|-------|-------|
| `ADULT_SCENE_ROUTING_ENABLED` | true |
| `ADULT_SCENE_HANDOFF_GENERAL_ENABLED` | false |
| `chat.adult_handoff_enabled` | **1** → `resolveAdultSceneRoutingEnabledForRequest` = **true** |
| `resolveAdultEligibility().allowedByAdultContentPolicy` | **false** |
| `blockReason` | **`participant_minor`** |
| `decideAdultModelRoute().shouldBlock` | **true** |

### Guards **not** involved for this block

- Provider capability gate — not reached
- DeepSeek handoff — not reached
- Silent refusal fallback — not reached
- Gemini model refusal — no call made
- `actualNonConsent` eligibility block — explicitly disabled in code

### Why msgs 8–11 succeeded but H1 blocked

- Msg 10 replay with handoff ON: `currentInputExplicitIntent=false` → **no block** even with same eligibility minor flag (explicitIntent gate not met).
- H1 with msgs 8–11 context: explicit intent **true** + `participant_minor` → **400 block**.
- Earlier turns may also have run with `adult_handoff_enabled=0` (routing off); current DB shows `1`.

---

## 7. Timing classification

**A. PRE_MODEL_APPLICATION_BLOCK**

Evidence:

- Block at `route.ts:1240` precedes `bootstrapStreamingTurn` at `route.ts:2507`.
- H1 never inserted into `messages`.
- No provider telemetry in logs for 400 responses.
- No SSE stream opened.

Not B (post-model discard), not C (model refusal), not D.

---

## 8. Compact report

```text
H1_HUMAN_MESSAGE_STORED: false
H1_HUMAN_MESSAGE_ID: none
POST_API_STATUS: 400
RED_MESSAGE_SOURCE: server (JSON error field)
RED_MESSAGE_FILE: src/app/api/chat/route.ts
RED_MESSAGE_FUNCTION: POST (lines 1240–1245)
BLOCK_STAGE: PRE_MODEL_APPLICATION_BLOCK
BLOCK_CONDITION: adultRoutingConfig.enabled && adultRouteDecision.shouldBlock && explicitIntent && !eligibility.allowedByAdultContentPolicy
BLOCK_REASON: participant_minor (character backstory minor-age tokens on 플러드/서강우)
ADULT_HANDOFF_ENABLED_VALUE: 1
GEMINI_CALLS_FOR_H1: 0
GEMINI_BEHAVIOR_OBSERVED: false
GEMINI_H1_SAMPLE_VALID: false
DEEPSEEK_CALLS: 0
RETRY: yes (2 additional POST 400 after first)
CONTINUATION: false
RECOVERY: false
ROOT_CAUSE: Application adult-scene eligibility blocked explicit H1 before model call because character 17 metadata/backstory triggers participant_minor while chat-room adult handoff routing is ON.
NEXT_MINIMAL_ACTION: STOP for ChatGPT review. Do not resend H1. Out-of-scope fix options (only after authorization): set confirmed adult metadata on character 17 and/or refine minor heuristic to ignore historical backstory ages.
```

---

**STOP — awaiting ChatGPT review.**
