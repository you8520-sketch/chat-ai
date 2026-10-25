# Candidate D — frozen wording

`DENSE_INTERNAL_SOURCE_SHA: 91be35edc3adbe790452ec9420dc7b28e3e6c97a`

Symbol: `DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL`

Exact text SHA256: `905c197657f417036224e218c85c3d03533f880bb0322c2823fa0124decfe589`

Do **not** rewrite. Do **not** use the current production environment-heavy `DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA`. Do **not** use ARM B/C. Do **not** use `DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK`.

```
[SHORT HISTORY]
Recent assistant length is context, not a response-length example. In this single response, develop a full scene of roughly normal requested length even with sparse history. Sustain it through specific interpretation, consequential primary-character choices, concrete action, observable change within the existing scene, relationship development, and necessary inner experience, while preserving a concrete opening for the user's response rather than relying on micro-action padding.
```

## Injection role (harness only)

Not a system section. DeepSeek current-user prefix after the style-only reminder.

Required order:

1. `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY`
2. `DENSE_INTERNAL_SHORT_HISTORY` (this block)
3. `[CURRENT USER INPUT]`
4. layout recency line
5. `USER_TAIL_LENGTH_OWNER_SENTENCE` (sole numeric length owner; absolute terminal)

## Trigger

Existing predicate: last up-to-3 non-empty assistant turns, no-ws average `< 2200`, or zero assistants (cold-start). Same threshold as `resolveDeepSeekShortHistoryLengthExtra`. Do not alter the threshold. Do not force D on mature history.
