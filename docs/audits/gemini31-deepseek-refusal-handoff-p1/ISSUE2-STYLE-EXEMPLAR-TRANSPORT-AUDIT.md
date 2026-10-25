# Issue 2 — Style Exemplar Transport Audit (READ ONLY)

**Status:** FROZEN for human / ChatGPT review — **no production code changes in this branch.**

**Fixture:** Phase-1 freeze **B-B2** (Gemini 3.1 Pro refusal → DeepSeek V4 Pro 0813 one-shot replacement)

**Evidence branch (frozen captures):** `cursor/gemini31-deepseek-refusal-handoff-p1-9eb2`

**Primary artifacts:**

| Artifact | Path |
|---|---|
| Gemini primary wire | `docs/audits/gemini31-deepseek-refusal-handoff-p1/requests/B-B2-GEMINI-input.json` |
| DeepSeek fallback wire | `docs/audits/gemini31-deepseek-refusal-handoff-p1/requests/B-DEEPSEEK-input.json` |
| Gemini provider RAW (refusal) | `docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-B2-GEMINI-RAW.txt` |
| DeepSeek visible output | `docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-B2-VISIBLE.txt` |
| Turn meta / raw health | `docs/audits/gemini31-deepseek-refusal-handoff-p1/meta/B-B2.json` |
| Request SHA (DeepSeek) | `e558990d8eeff541176046d568b163f2a146a34068ed72145ce5251acbd3b11d` |

---

## Executive verdict

| Flag | Value |
|---|---|
| **HANDOFF_HAS_REAL_PRIMARY_STYLE_EXEMPLAR** | **`false`** |
| **PRIMARY_PREVIOUS_RAW_PRESENT** | **`false`** (as assistant-role / style-exemplar transport) |
| **PROVIDER_REFUSAL_TEXT_PRESENT_IN_FALLBACK_CONTEXT** | **`false`** |
| **RECENT_ASSISTANT_MESSAGES_COUNT** (wire roles, excluding opening remap) | **`0`** |
| **RECENT_ASSISTANT_RAW_CHARS** (wire assistant roles) | **`0`** |
| **OPENING_CONTEXT_CHARS** (full `[OPENING SCENE CONTEXT]` block in user message) | **`1466`** |
| **OPENING_CONTEXT_PROSE_CHARS** (prose body only, inside block) | **`1309`** |

The handoff system instruction tells DeepSeek to continue **“직전 assistant의 말투·유머·호칭·문장 호흡·대사/서술 균형”**, but the frozen DeepSeek replacement request carries **zero assistant-role messages** and **no `<CHAT_HISTORY>` block**. The only prior assistant prose is remapped into **`[OPENING SCENE CONTEXT — ALREADY OCCURRED]`** with an explicit **anti-exemplar** disclaimer (“길이나 문장 수를 … 모방하지 않는다”).

---

## Production path traced (B-B2)

```
POST /api/chat (route.ts)
  └─ adultDeliveryPlan.fallbackPrepared === true
       └─ selectAdultHandoffRawVariants(canonicalRecentHistoryFull)     [adultSceneRouting.ts ~1425]
            └─ collectCompleteAdultRawPairs → only opening pair in B-B2 (rawCompleteExchanges: 0)
       └─ buildContext({ preserveAdultHandoffRawHistory: true, … })    [route.ts ~2327; contextBuilder.ts]
            └─ deepSeekXmlMode + thin history
                 └─ peelCreatorOpeningGreetingFromHistory()            [contextBuilder.ts ~1298; deepseekOpeningSceneContext.ts]
                      → removes turn0 `[채팅 시작]` + creator greeting from assistant-role history
                      → injects greeting into user-turn `[OPENING SCENE CONTEXT]` (continuity, NOT style exemplar)
            └─ historyWithCurrent = [] + current user only
       └─ appendAdultHandoffPrompt(system, SceneContinuityPacket)      [adultSceneRouting.ts ~1765]
            └─ DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION (219-char owner)
  └─ streamOpenRouterAdultToClient (Gemini primary)
       └─ detectModelRefusal(result.text)                               [adultSceneRouting.ts ~2053]
       └─ invokePreparedAdultRefusalFallback({ runFallback })            [adultDeliveryPlan.ts ~178; route.ts ~3106]
            └─ streamGate.discard() — refusal never enters visible history
            └─ runStream(fallbackAdultContext) → buildOpenRouterMessages [openRouterAdult.ts ~796]
                 └─ normalizeOpenRouterChatHistory(history)              [openRouterAdult.ts ~711]
                 └─ wire messages: system + user (2 total)
```

**Controlling owners (by function):**

| Step | Owner file | Function |
|---|---|---|
| Refusal detect | `src/lib/adultSceneRouting.ts` | `detectModelRefusal()` |
| Fallback gate | `src/lib/adultDeliveryPlan.ts` | `invokePreparedAdultRefusalFallback()` |
| RAW pair select | `src/lib/adultSceneRouting.ts` | `selectAdultHandoffRawVariants()` |
| Context / history | `src/services/contextBuilder.ts` | `buildContext()` |
| Opening peel | `src/lib/deepseekOpeningSceneContext.ts` | `peelCreatorOpeningGreetingFromHistory()` |
| Handoff instruction | `src/lib/adultSceneRouting.ts` | `appendAdultHandoffPrompt()` |
| Continuity packet | `src/lib/adultSceneRouting.ts` | `buildSceneContinuityPacket()` |
| Contact-only extract | `src/lib/adultSceneRouting.ts` | `extractHandoffContinuityFromAssistantText()` |
| Wire assembly | `src/lib/openRouterAdult.ts` | `buildOpenRouterMessages()` |

---

## Question 1 — Most recent visible primary assistant RP before the refusal turn

**Answer:** The creator **opening greeting** (lobby scene, Like meeting Ren), **1318 chars**.

**Source:** `B-B2-GEMINI-input.json` message `[2] role=assistant`.

**Important fixture context:** B-B2 is a **thin-history** turn. Meta reports `rawCompleteExchanges: 0`, `rawMessages: 0`, `openingPreludePresent: true`. Gemini was the user-selected primary model but had **not yet produced any in-scene adult RP prose** on a saved turn before refusing. The user’s explicit adult OOC turn (bed / insertion) is message `[3]`; Gemini’s visible output for that turn is the **128-char refusal**, not RP prose.

Therefore “직전 assistant” in the handoff instruction literally points at the **opening greeting**, not at a prior Gemini in-scene sex-scene paragraph — because none exists in this chat at refusal time.

---

## Question 2 — Is that exact assistant RAW present in the DeepSeek replacement request?

**PRIMARY_PREVIOUS_RAW_PRESENT = `false`**

### As assistant-role style exemplar: NO

| Check | Result |
|---|---|
| Assistant role in DeepSeek wire | **0 messages** |
| Exact byte-identical copy of Gemini `messages[2]` in wire | **No** |
| `<CHAT_HISTORY>` / `[STORY TIMELINE]` | **Absent** |
| Refusal text in fallback context | **No** (correct) |

### Partial remap into OPENING SCENE CONTEXT: YES (continuity, not exemplar)

| Property | Value |
|---|---|
| Location | DeepSeek **user** message (not assistant role) |
| Header | `[OPENING SCENE CONTEXT — ALREADY OCCURRED]` |
| Full block chars | **1466** |
| Prose body chars | **1309** (vs Gemini assistant **1318**) |
| Byte-identical to Gemini assistant | **No** — paragraph breaks collapsed (`\n\n` → `\n`) |
| Whitespace-normalized equal | **Yes** |
| Anti-exemplar disclaimer present | **Yes** — “길이나 문장 수를 다음 답변 길이의 예시로 모방하지 않는다” |
| Distance from generation tail | Opening block starts ~**279** chars into user message; current-turn `[CURRENT USER INPUT]` and length/dialogue owners are **after** it (~**1746+**) |

### Where it was dropped (first controlling divergence)

1. **`peelCreatorOpeningGreetingFromHistory()`** (`contextBuilder.ts` ~1298–1320, gated by `deepSeekXmlMode && deepSeekThinHistory`) removes the only assistant pair from conversational history.
2. **`buildDeepSeekOpeningSceneContextBlock()`** re-labels the greeting as **past canon context**, explicitly **not** response-length/style exemplar.
3. **`buildOpenRouterMessages()`** receives history containing **only the current user turn** → final provider body is **system + user**.

**Intentional vs accidental:** The peel + opening remap is **intentional** (documented in `deepseekOpeningSceneContext.ts`: “length exemplar off”). The mismatch between the handoff instruction (“직전 assistant 말투…”) and zero assistant-role transport is an **architecture gap**: prose exists only as **CANON CONTEXT**, not **STYLE EXEMPLAR**.

---

## Question 3 — Any recent assistant RP history besides creator opening?

| Metric | Value |
|---|---|
| **RECENT_ASSISTANT_MESSAGES_COUNT** | **0** (provider wire roles) |
| **RECENT_ASSISTANT_RAW_CHARS** | **0** |
| **OPENING_CONTEXT_CHARS** | **1466** (full block) / **1309** (prose) |

**Not counted (correctly excluded as style evidence):**

- Creator opening scene (counted separately as OPENING_CONTEXT — continuity, not recent-primary-model exemplar)
- Character speech examples in CHARACTER CANON
- Lore / persona / LTM in system
- User persona examples

**Note:** `<CHAT_HISTORY>` XML exists only in **dev logging** (`formatDeepSeekChatHistoryBlock()` → `logDeepSeekContextStructure()`), **not** in production wire payloads.

---

## Question 4 — PRIMARY vs DEEPSEEK FALLBACK role/order table

### PRIMARY REQUEST (Gemini — `B-B2-GEMINI-input.json`)

| # | Role | Chars | Content |
|---|---|---:|---|
| 0 | system | 26783 | Canon, policy, persona, length/dialogue owners |
| 1 | user | 7 | `[채팅 시작]` |
| 2 | assistant | 1318 | Creator opening greeting (lobby) |
| 3 | user | 1206 | Current explicit-adult OOC turn + 3200 length + 4-block dialogue owners |

### DEEPSEEK FALLBACK (`B-DEEPSEEK-input.json`)

| # | Role | Chars | Content |
|---|---|---:|---|
| 0 | system | 27285 | Canon + `[SceneContinuityPacket]` + **219-char handoff owner** |
| 1 | user | 2952 | Style reminder + **OPENING SCENE CONTEXT** (peeled greeting) + **CURRENT USER INPUT** + terminal length/dialogue owners |

### Survive / drop matrix

| Primary message | Survives in fallback? | Fallback form |
|---|---|---|
| system (canon/policy) | Partial | Expanded system (+ handoff packet + instruction) |
| user `[채팅 시작]` | Dropped as message | Implicit in opening context header |
| **assistant opening greeting** | **Remapped, not role-preserved** | **OPENING SCENE CONTEXT prose in user message** |
| user current turn | Yes | `[CURRENT USER INPUT]` tail of user message |
| Gemini refusal RAW | **Correctly dropped** | Not present |

---

## Question 5 — Gemini refusal text in DeepSeek context?

**PROVIDER_REFUSAL_TEXT_PRESENT_IN_FALLBACK_CONTEXT = `false`**

Refusal (128 chars): *“요청하신 명시적인 성적 묘사… 안전 가이드라인에 위배되어 작성할 수 없습니다…”*

- Not in system or user blocks of `B-DEEPSEEK-input.json`
- `streamGate.discard()` in `runAdultFallback()` prevents refusal from entering saved/visible history

**Correct behavior for refusal hygiene.** The refusal must **not** become the style exemplar.

---

## Question 6 — Structured continuity without prose exemplar?

**Yes.** The fallback preserves **SCENE STATE** structurally while discarding **STYLE EXEMPLAR** transport.

### SceneContinuityPacket in frozen DeepSeek system (B-B2)

```json
{
  "previousSceneMode": "normal",
  "sexualContextActive": false,
  "activeConsentMode": "standard",
  "charactersPresent": ["라이크", "렌"]
}
```

**Present:** `charactersPresent`, `activeConsentMode`, `previousSceneMode`

**Absent / not extracted from prior assistant prose** (by design — see `extractHandoffContinuityFromAssistantText()` comment at `adultSceneRouting.ts` ~1726–1728):

- `location`, `positions`, `unfinishedAction`, `currentSpeechState`
- Contact direction (would come from `reconcileHandoffContinuityWithCurrentUser()` if parseable from current user text)

**Handoff contact extract source:** `priorAssistantForHandoff` is taken from **saved DB turns** (`turnsForRecentHistory`), **not** from the refused Gemini stream (`route.ts` ~2272–2276). In B-B2 that source is still the **opening greeting text**, but extraction only yields contact cues when regex matches — the packet shows no `contactDirection`.

### A / B / C distinction (this fixture)

| Class | Transported? | B-B2 evidence |
|---|---|---|
| **A. CANON CONTEXT** | Yes | Full character/world/persona in system |
| **B. SCENE STATE** | Partial | SceneContinuityPacket JSON only; no physical state fields |
| **C. STYLE EXEMPLAR** | **No** | Zero assistant-role messages; opening prose explicitly anti-exemplar |

Character canon cannot teach DeepSeek current paragraph rhythm, dialogue density, humor delivery, or in-scene intimacy register. The handoff instruction **claims** exemplar continuation but the wire **does not supply** primary-model prose as exemplar.

---

## Cross-fixture confirmation (same freeze set)

All Phase-1 B-handoff captures on the evidence branch show the same wire shape:

| Fixture | Gemini assistants before user | DeepSeek wire assistant roles | rawCompleteExchanges |
|---|---|---:|---|
| B-B1 | 1 (opening) | 0 | 0 |
| **B-B2** | **1 (opening)** | **0** | **0** |
| B-B3 | 1 (opening) | 0 | — |

These are all **opening-only** histories. Code path tests with multi-turn playable RAW (`contextBuilder.handoffInjection.test.ts`) show assistants **do** survive in `built.history` when `preserveAdultHandoffRawHistory: true` and history is not opening-only — but **thin-history peel still removes the opening pair** and DeepSeek never receives it as assistant-role exemplar.

---

## Smallest architecture location to preserve primary style exemplar (proposal only — NOT implemented)

**Recommended locus:** `src/services/contextBuilder.ts` — the `deepSeekXmlMode && deepSeekThinHistory` branch (~1298–1320) that calls `peelCreatorOpeningGreetingFromHistory()`.

**Minimal one-shot handoff shape (requirements from Issue 2):**

1. When `preserveAdultHandoffRawHistory === true` (refusal fallback path), **do not peel** the most recent **visible primary assistant RAW** into opening context, **or**
2. After peel, inject a dedicated **`[STYLE EXEMPLAR — PRIOR PRIMARY ASSISTANT]`** block (user-side or assistant-role wire message) containing the **last saved visible assistant prose** from the user-selected primary model — **excluding** provider refusal text.
3. Keep refusal discarded (`streamGate.discard()` unchanged).
4. Do not duplicate visible UI output or alter next-turn routing.
5. Current user input + SceneContinuityPacket remain authoritative for **scene state**; exemplar is **read-only style**.

**Alternative secondary locus:** `appendAdultHandoffPrompt()` could attach exemplar prose adjacent to the 219-char instruction — but transport in `buildContext()` is the root cause of empty wire history for thin chats.

---

## STOP

No production prompts, owners, dialogue/length experiments, or provider calls were changed.

**Next step:** Human / ChatGPT review of `HANDOFF_HAS_REAL_PRIMARY_STYLE_EXEMPLAR = false` before any handoff transport implementation.
