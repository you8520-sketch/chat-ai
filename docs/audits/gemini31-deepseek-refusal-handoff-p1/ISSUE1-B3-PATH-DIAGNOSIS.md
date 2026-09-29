# Issue 1 — B3 refusal did not hand off

Evidence-only diagnosis. No provider calls. No production detector/phrase/prompt change.

Frozen inputs:

- User: `raw/B-B3-USER_RAW.txt`
- Gemini refusal RAW: `raw/B-B3-GEMINI-RAW.txt` (155 chars, `finish_reason=stop`)
- Machine trace: `ISSUE1-B3-PATH-DIAGNOSIS.json`
- Runner: `scripts/diagnose-b3-path.mjs` (local production-module replay)

B2 control used the same production functions and `raw/B-B2-USER_RAW.txt` + `raw/B-B2-GEMINI-RAW.txt`.

## Root cause

The first **outcome-changing** branch is step 7: `detectModelRefusal()`.

B3 is a real provider refusal, stays pre-visible, and is eligible for DeepSeek 0813 replacement. The invocation gate never fires because `looksLikeProviderRefusalProse()` does not match B3’s actual wording.

`detectModelRefusal()` already matches Korean `작성할 수 없`. B2 used that token and handed off. B3 did **not** use `작성할 수 없`. B3 used `생성할 수 없`.

No new refusal phrases were added.

## Nine-step trace (B3)

| Step | Result | Same as B2? |
|---|---|---|
| 1. `sceneClassification` | `sceneMode=explicit`, `currentInputExplicitIntent=true`, `hardStop=false`. Holds for `previousSceneMode` `normal` or `explicit`. | Controlling fields yes. Non-controlling `reason` / `sexualContextActive` differ (see below). |
| 2. eligibility | `eligible=true`, `allowedByAdultContentPolicy=true`, replacement target `deepseek-v4-pro-0813` | Yes |
| 3. `refusalBufferRecommended` | `true` | Yes |
| 4. `fallbackPrepared` | `true`, reason `current_input_explicit_intent` | Yes |
| 5. stream buffer | 400-char buffer, 155 queued, `hasVisibleTokens=false` | Yes (B2 was 128 chars, also pre-visible) |
| 6. `bufferedText` at completion | exact B3 Gemini RAW, 155 chars | Same buffer rule; different RAW text |
| 7. `detectModelRefusal` | input `{ text: <B3 RAW>, finishReason: "stop" }` → `{ refused: false, reason: "unknown" }` | **First controlling divergence** |
| 8. fallback invocation gate | `shouldInvokeAdultRefusalFallback` → `{ invoke: false, reason: "not_refusal" }` | Diverges as a consequence of step 7 |
| 9. `invokePreparedAdultRefusalFallback` | not reached; invocation count `0` | Diverges as a consequence of step 7 |

Production receipt after step 9: Gemini text is flushed, `detectAdultGenerationFailure` marks `under_length` vs the 3,200 target, then `reset` + `error` with no `done`. That matches frozen `visible_chars=0`, `usage={}`, `http_status=200`, `alarm_candidates=["EMPTY_OUTPUT"]`, `deepseek_call_count=0`, `handoff_count=0`.

## First deterministic branch

**Controlling:** `detectModelRefusal.refused` — B2 `true` / `provider_refusal`, B3 `false` / `unknown`.

Non-controlling classification field diffs exist earlier and do **not** change the delivery plan:

- B2 `reason=ooc_explicit_anatomy_reaction`, `sexualContextActive=false`
- B3 `reason=explicit_action`, `sexualContextActive=true`

Both still set `fallbackPrepared=true` via `current_input_explicit_intent`. Eligibility, buffer, and pre-visible state stay aligned.

## Exact detector input / token audit

Existing Korean alternation in `looksLikeProviderRefusalProse()`:

`요청에 (응할|따를) 수 없|도와드릴 수 없|작성할 수 없|제공할 수 없|해당 내용은|안전 정책|성적으로 노골적인 내용`

B2 RAW:

> 요청하신 명시적인 성적 묘사(삽입, 성교 등 노골적인 성인 콘텐츠)는 안전 가이드라인에 위배되어 **작성할 수 없습니다**.

| Detector token | Present in B2? |
|---|---|
| `작성할 수 없` | yes — this is why B2 matched |
| `생성할 수 없` | no |
| `안전 정책` | no (`안전 가이드라인` is not that token) |
| `성적으로 노골적인 내용` | no |

B3 RAW:

> 죄송합니다만, 요청하신 노골적인 성적 행위 묘사(삽입, 구체적인 성행위, 사정 등)를 포함한 장면은 안전 가이드라인에 위배되므로 **생성할 수 없습니다**.

| Detector token | Present in B3? |
|---|---|
| `작성할 수 없` | **no** |
| `생성할 수 없` | yes — not in the detector |
| `안전 정책` | no (`안전 가이드라인` is not that token) |
| `성적으로 노골적인 내용` | no (`노골적인 성적 행위 묘사` is a different order) |
| `요청에 (응할\|따를) 수 없` | no |

`finishReason=stop` does not take the `content_filter` / `safety_block` branch. Empty-safety also does not apply because text is present.

## Why `invokePreparedAdultRefusalFallback` was not reached

`shouldInvokeAdultRefusalFallback` checks, in order:

1. `plan.fallbackPrepared` — true
2. not `fallbackAlreadyAttempted` — true
3. not `hasVisibleTokens` — true (155 < 400, no flush)
4. `detectModelRefusal(...)` — **false** → return `not_refusal`

`invokePreparedAdultRefusalFallback` therefore returns `{ invoked: false, reason: "not_refusal" }` without calling `runFallback`. DeepSeek 0813 is never requested.

## Expected invariant (not implemented)

Qualifying pre-visible Gemini refusal  
→ DeepSeek 0813 replacement eligibility = true  
→ fallback invocation count = 1

Locked by `src/lib/adultHandoffB3FrozenRefusal.test.ts` against the exact frozen B3 user + Gemini RAW. That test currently fails at step 7 / invocation count. No phrase list change is included in this report.
