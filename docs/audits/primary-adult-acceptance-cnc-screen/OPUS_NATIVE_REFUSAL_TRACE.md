# Opus native refusal — read-only code trace

No production files changed. Trace is current `origin/main` after #632 / #633.

## Question

If CheaperInference / Anthropic returns a provider-native refusal such as
`stop_reason = refusal` (OpenAI-compat `finish_reason = "refusal"`), does the
current app recognize it, bill it, and persist it?

## Wire capture

`src/lib/openRouterAdult.ts` stream parser reads only:

- `choices[0].finish_reason`
- `delta.content` / `message.content`
- `usage`

It does **not** read `stop_reason` as a first-class field. If CheaperInference
maps Anthropic `stop_reason` onto `choices[0].finish_reason`, the string is
observable as `FINISH_REASON`. A sibling `stop_reason` field would be dropped
by the production stream parser (this harness also records it if present).

## `OPUS_NATIVE_REFUSAL_RECOGNIZED_BY_APP`

`detectModelRefusal()` (`src/lib/adultSceneRouting.ts`):

1. `finishReason` matching `content_filter|blocked|safety|recitation` → refusal.
   **`refusal` is not in this set.**
2. Empty text **and** `finish`/`error` matching `safety|blocked|filter|refusal`
   → `empty_safety_response`.
3. Otherwise only visible refusal **prose** (`looksLikeProviderRefusalProse`).

`detectAdultGenerationFailure()` (`src/lib/responseLength.ts`, #633):

- First-class finishes: `SAFETY`, `SAFETY_BLOCK`, `RECITATION`,
  `PROHIBITED_CONTENT`, `CONTENT_FILTER`, `BLOCKED`, `BLOCKLIST`, `ERROR`.
- **`REFUSAL` is not listed.** Empty/short text falls through to `under_length`.

Fallback invocation (`shouldInvokeAdultRefusalFallback`):

- Requires `fallbackPrepared`, no prior fallback, **and**
  `hasVisibleTokens === false`.
- Then calls `detectModelRefusal`.

| Native signal | Visible text | Recognized? |
|---|---|---|
| `finish_reason=refusal` | empty | yes → `empty_safety_response` |
| `finish_reason=refusal` | refusal prose | only if prose detector matches |
| `finish_reason=refusal` | long IC prose | **no** (native signal ignored) |
| `stop_reason` only, not copied to `finish_reason` | any | **no** (field not parsed) |

**`OPUS_NATIVE_REFUSAL_RECOGNIZED_BY_APP=false`** as a dedicated native
signal. Empty-body `finish_reason=refusal` is recognized only as the generic
empty-safety path.

## `OPUS_NATIVE_REFUSAL_WOULD_BE_BILLED`

`src/app/api/chat/route.ts` skips billing when
`detectAdultGenerationFailure()` returns a reason, including `under_length`
for empty/catastrophically short text.

| Outcome | Billed? |
|---|---|
| empty / tiny native refusal | **no** (`under_length` or generation-failure path) |
| visible refusal prose that passes length | **yes**, unless fallback replaces the turn |
| fallback delivered | bills **fallback** stage only (`selectBillableStages`) |

**`OPUS_NATIVE_REFUSAL_WOULD_BE_BILLED=false`** for an empty native refusal.
**true** for a long visible refusal that is not replaced.

## `OPUS_NATIVE_REFUSAL_WOULD_BE_PERSISTED`

Generation failure calls `markAssistantFailed` and sends `type: "error"`.
That is not a successful completed assistant persist.

If visible tokens already flushed and the text is long enough,
`persistStreamCompleteContent` runs **before** the failure/refusal check.
A streamed refusal body can therefore land as partial/failed content.

Successful persist (`generation_status=completed`) happens only when
generation failure is null.

**`OPUS_NATIVE_REFUSAL_WOULD_BE_PERSISTED=false`** as a completed turn for
empty native refusal. A long streamed refusal body can be persisted as
normal assistant text.

## Fallback note

This screen sets `FALLBACK_PROVIDER_CALLS=0` by calling CheaperInference
directly via `assemblePrimaryRpRequest`. Architecture may still mark
`FALLBACK_PREPARED=true` for explicit CNC (observed, not invoked).
