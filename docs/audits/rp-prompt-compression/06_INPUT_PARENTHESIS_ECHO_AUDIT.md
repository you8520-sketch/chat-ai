# 06 Input Parenthesis / Echo Audit

## Fixture input

```text
신입 ...맞아.나 본적있어?(갸웃)나는 렌이라고 부르면 돼.
```

## Parser / formatter (offline)

```text
parts:
- dialogue: raw="신입 ...맞아.나 본적있어?" promptText="신입 ...맞아.나 본적있어?"
- action: raw="(갸웃)나는 렌이라고 부르면 돼." promptText="(갸웃)나는 렌이라고 부르면 돼."

formatUserMessageForPrompt expected form: FAIL

expected:
  [유저 대사] 신입 ...맞아.나 본적있어?
  [유저 지문/행동 — 캐릭터가 관찰 가능]
  갸웃
  [유저 대사] 나는 렌이라고 부르면 돼.

actual:
  [유저 지문/행동 — 캐릭터가 관찰 가능]
  (갸웃)나는 렌이라고 부르면 돼.
```

literal `(갸웃)` locations in formatter pipeline:

```text
raw_user_input
formatUserMessageForPrompt
wrapCurrentUserInput
part:action:rawText
part:action:promptText
→ CURRENT USER turn in assembled outbound payload (all 4 models)
```

### Root cause (code path — API calls = 0)

1. `parseUserMessageParts` finds `(갸웃)` as a parenthetical.
2. Trailing text `나는 렌이라고 부르면 돼.` is misclassified as **action** by `classifyPlainSentence` because `NARRATIVE_CLOSING_RE` matches a bare `고` inside `라고` via `(?:스|시|으)?(?:며|고|면서|…)` with an empty optional prefix.
3. `mergeAdjacentParts` concatenates `(갸웃)` + that trailing clause into one action string.
4. `promptTextForUserPart` / `stripActionWrapper` only strips when the **entire** string is parenthesis-wrapped; the merged string is not → **`(갸웃)` literal survives**.

```text
RAW_PARENTHESES_LEAK = YES
USER_INPUT_SURFACE_ECHO (wrapper tokens) = YES — prompt-side
fix files: src/lib/userMessageParse.ts (classifyPlainSentence / mergeAdjacentParts),
            src/lib/userActionThoughtRules.ts (formatUserMessageForPrompt)
```

No production fix in this audit (docs/scripts only).

### Formatted body (actual)

```text
[유저 대사]
신입 ...맞아.나 본적있어?

[유저 지문/행동 — 캐릭터가 관찰 가능]
(갸웃)나는 렌이라고 부르면 돼.
```

## Outbound assemble (NORMAL) — literal `(갸웃)`

| Model | in system | in history | in current user turn | bare 갸웃 in user turn |
|---|---|---|---|---|
| Claude Opus 5 | false | false | true | true |
| Gemini 3.1 Pro Preview | false | false | true | true |
| DeepSeek V4 Pro | false | false | true | true |
| GPT-5.6 Terra | false | false | true | true |

```text
RAW_PARENTHESES_LEAK in outbound prompt = true
```

## Gemini user dialogue echo (completed user lines re-performed)

Separate from parenthesis wrappers: Gemini has reprinted completed user dialogue such as “신입 …맞아. 나 본 적 있어?” / “나는 렌이라고 부르면 돼.”

Offline duplication check:

```text
history duplicate of this user utterance: NO
creator greeting duplicate: NO
example dialogue contains (갸웃) / this utterance: NO
raw/formatted current user contains the dialogue once: YES (expected once)
```

For **full dialogue re-performance** in assistant prose (beyond seeing the labeled user turn once):

```text
prompt duplicate of user dialogue beyond the single CURRENT USER block: NO
likely MODEL_COMPLIANCE_ECHO for dialogue re-acting: YES (still possible)
```

But for **literal `(갸웃)` in assistant output**, the outbound prompt **does** contain the raw wrapper due to the parser merge bug — that is **not** “prompt clean”.

### Verdict

```text
RAW_PARENTHESES_LEAK = true
locations = formatUserMessageForPrompt → wrapCurrentUserInput → user turn (all models)
parser output = merged action retaining (갸웃)
likely cause = NARRATIVE_CLOSING_RE false-positive on "라고" + mergeAdjacentParts

USER dialogue re-performance (without requiring parentheses):
  prompt duplicate beyond single current-user block = NO
  MODEL_COMPLIANCE_ECHO = YES (still plausible for Gemini)

REASONED_CANON_CONTINUATION (기시감 etc. from creator canon) = separate issue; not this leak
```
