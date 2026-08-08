# 03 — Regeneration & Variant Lifecycle

Read-only audit of regeneration scope and variant semantics. These answers determine Numeric State v1 difficulty.

## Regeneration scope

| Layer | Behavior | Evidence |
|---|---|---|
| UI | Regenerate button only on **latest** assistant | `ChatClient.tsx:3444` `showRegenerate={i === lastAssistantIdx && !inputLocked}`; `regenerate()` defaults to `lastAssistantIdx` (2899) |
| API | Accepts **any** assistant via `targetAssistantMessageId` / `regenerateMessageId` / `messageId` | `route.ts:494-496` |
| Boundary resolver | Finds target by ID or latest non-greeting assistant; builds history = messages before parent user | `regenerationContext.ts:72-118` `resolveRegenerationContextBoundary` |
| Server guard for messages after target | **None.** Future messages are traced (`excludedMessageIdsAfterTarget`) but not rejected | `regenerationContext.ts:141,178`; test `regenerationContext.test.ts:70-97` shows msg 5 excluded from history but regen of msg 4 is allowed |

**Conclusion:** UI = latest only. Server = any past assistant if the client sends `targetAssistantMessageId`. There is **no block** on regenerating a past turn that has later messages in the DB.

## Variant structure

`MessageVariant` (`messageAlternates.ts:6-17`):
```text
content, model, usage, created_at,
statusWidgetValues?, statusWidgetTurnActive?,
generationSequence?, requestId?, sourceMessageId?
```

Storage: `messages.alternates` (JSON array), `messages.active_variant` (index), `messages.content`/`usage`/`model` mirror active variant.

- First generation: `alternates=[newVariant]`, `active_variant=0` (`route.ts:4447`).
- Regen: prior variants preserved; new variant appended (`appendMessageVariant`, `route.ts:4378-4396`).
- `generationSequence` = `prevVariants.length` on regen (0 for first, 1 for first regen, …) — **not a global monotonic counter**.

## Variant switch after generation

`PATCH /api/chat/message/variant` (`variant/route.ts:18-126`) — **yes**, active variant can be switched back to A/B after generation. Guard: `variants.length > 1`, any assistant non-greeting message.

## Synchronization on variant switch

| Artifact | Synchronized? | Code |
|---|---|---|
| `status_widget_values_json` | **Yes** — from `selectedVariant.statusWidgetValues` | `variant/route.ts:71-93` |
| `status_widget_turn_active` | **Yes** | 91 |
| `content`, `model`, `usage`, `adult_route_meta_json` | **Yes** | 81-93 |
| Episodic facts | **No** — no DB touch | entire route |
| Trigger events | **No** — no DB touch | entire route |
| Client `statusWidgetValues` UI state | **No** — `switchVariant` updates content/variants but not `statusWidgetValues` (`ChatClient.tsx:3101-3128`) |

## Answers to required questions

```text
regeneration은 항상 최신 assistant turn에만 가능한가?
  → UI: yes. Server: no (any past assistant accepted).

과거 assistant turn도 regenerate 가능한가?
  → Server: yes (if client sends targetAssistantMessageId). UI does not expose it.

생성 후 active variant를 다시 A/B로 전환할 수 있는가?
  → Yes (PATCH /api/chat/message/variant).

variant 전환 후 status_widget_values_json이 동기화되는가?
  → Yes.

variant 전환 후 episodic facts가 동기화되는가?
  → No.

variant 전환 후 trigger events가 동기화되는가?
  → No.
```

## Implications for Numeric State

1. **Historical regeneration is server-possible.** If a user (or future UI) regenerates T10 after T12 exists, T11/T12 numeric state was computed on top of T10-A. Regenerating T10 to T10-B would require **rebase/replay** of T11/T12, not a simple rollback. v1 must either (a) block historical regen for numeric-state chats, or (b) implement replay. **Recommend (a) for v1** — restrict numeric-state regen to latest assistant only, matching current UI.

2. **Variant switch does not reconcile numeric state, episodic facts, or triggers.** This is an existing divergence bug surface. If variant A had `corruption=75` (fired a trigger) and the user switches to variant B (`corruption=40`), the trigger event from A remains and the message column now shows B's values. Future numeric state must either (a) key state by `source_turn` only (variant-agnostic — last finalized wins) or (b) replay on switch. **Recommend (a)** — numeric state is turn-keyed, written once per finalized turn; variant switch updates the display snapshot only, not canonical numeric state.

3. **`generationSequence` is per-message, not global.** It cannot serve as a global ordering key across messages. Idempotency for numeric commit must use `(chat_id, assistant_message_id, state_key)` or `(chat_id, source_turn, state_key)` plus `request_id`.

4. **Variant switch leaves stale trigger events.** See doc 05 — same root cause.
