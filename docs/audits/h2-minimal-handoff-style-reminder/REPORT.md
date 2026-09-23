# Issue 2 — H2 minimal handoff style reminder

Surgical removal of the paragraph-consolidation clause from the DeepSeek style reminder on **adult handoff only**. Native DeepSeek unchanged. **Do not merge.**

## Production change (one semantic delta)

For non-DeepSeek → DeepSeek V4 Pro 0813 adult handoff:

- **Before (A):** full `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY`
- **After (H2):** `DEEPSEEK_BOTTOM_REMINDER_STYLE_HANDOFF` — same reminder minus:

  > 지문은 이어지는 행동·감각·의도를 같은 의미 단락 안에서 자연스럽게 연결하며, 짧은 문장마다 새 문단을 만들거나 한두 단어짜리 파편문을 습관적으로 반복하지 않는다.

Progressive-scene clause retained. No replacement prose. Prompt shorter than A by **92 chars**.

Implementation: `useDeepSeekHandoffStyleReminder` on `ContextBuildInput` → `prependDeepSeekHandoffStyleOnlyReminder` in `contextBuilder`; set in adult-handoff fallback paths in `route.ts`.

## Static tests — PASS

| Check | Result |
|-------|--------|
| NATIVE_DEEPSEEK_FULL_REMINDER_ACTIVE | true |
| ADULT_HANDOFF_H2_REMINDER_ACTIVE | true |
| H2_PARAGRAPH_CONSOLIDATION_CLAUSE_PRESENT | false |
| H2_PROGRESSIVE_SCENE_CLAUSE_PRESENT | true |
| T1/T2 byte-identical exemplars | true |
| A_REQUEST_SHA gate | `d155d083…` PASS |

`H2_ONLY_DELTA_IS_PARAGRAPH_CLAUSE_REMOVAL=true`, `REMOVED_CHARS=92`

H2 request SHA: `12e44e4ba5c4cbb2f936dce894842b66adae86563c5c1b2ebb41f8e15fcc377b`

## One logical H2 turn

| Field | Value |
|-------|-------|
| LOGICAL_DEEPSEEK_TURNS | 1 |
| CI_HTTP | 502 → OpenRouter backup |
| DELIVERED_PROVIDER | openrouter |
| PROVIDER_MATCHED_A_CONTROL | A_629_OPENROUTER (#629) |
| H2_RAW_SHA | `3739fb84117c943f32089303a10adcba1f7106a89f747905f90e4d09ab43fa03` |
| DELIVERED_FINISH_REASON | **error** (stream truncated mid-scene) |
| DELIVERED_ENDS_COMPLETE_SENTENCE | false |

**Important:** OpenRouter stream ended with `finish_reason=error` at ~1357 visible chars. Human review must treat length/completion metrics as **partial delivery**, not a full turn.

## Objective metrics (persisted-equivalent)

| Arm | Chars | Para | Dialogue | Dial/1k | Median narr |
|-----|-------|------|----------|---------|-------------|
| T3 Gemini GOLD | 2651 | 23 | 5 | 1.886 | 136.5 |
| A #625 CI | 2863 | 17 | 5 | 1.746 | 232 |
| A #629 OpenRouter | 2380 | 21 | 10 | 4.202 | 207 |
| **H2 OpenRouter** | **1357** | **13** | **6** | **4.422** | **153** |

Provider-matched A (#629 OpenRouter): median narration **207** vs H2 **153** (closer to Gemini T2=154, T3=136.5) — but H2 output truncated.

## Dialogue & T2 replay

| Arm | SOURCE_USER_QUOTED | T2_REPLAY_TOPICS |
|-----|-------------------|------------------|
| H2 | 0 | FIRST_KISS |
| A #629 OR | 0 | FIRST_KISS |
| H1 #626 OR | 1 | WHY_LOOKING, FOOD_HUNGER, FIRST_KISS |

H2 shows no current-user dialogue echo. T2 replay scope matches A OpenRouter (1 topic), narrower than H1 full-removal (3 topics).

## Audit addendum

- `USER_AGENCY_OWNER_ACTUALLY_ACTIVE=true`
- `CONTACT_ACTOR_EXTRACTION_BUG=true` (frozen)

## Human success target (Cursor does not decide)

H2 promising only if **both**:

1. Paragraph rhythm closer to Gemini PRIMARY than provider-matched A
2. A-like forward continuity (no broad T2 replay, no user dialogue echo, dialogue stable, T3 progression completes)

Partial truncation prevents conclusive judgment on criterion 2.

## STOP

Evidence frozen. Awaiting Human/ChatGPT RAW review. **Do not merge #620–#629 or H1 (#626).**
