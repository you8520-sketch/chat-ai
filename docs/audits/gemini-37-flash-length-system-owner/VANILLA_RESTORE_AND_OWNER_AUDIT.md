# Gemini 3.7 Flash — vanilla length restore + owner audit

```text
#432 SYSTEM owner = DISCARDED
B sentence restore = NO
C terminal sentence restore = NO
numeric-target A/B = NOT_RUN
VERDICT = KEEP_VANILLA
SOURCE_API_CALLS = 0
```

#432 was not a pure SYSTEM-owner add. Vanilla `USER_TAIL_LENGTH_OWNER_SENTENCE` was suppressed for Gemini 3.7 at the same time a new SYSTEM block was injected. That is two changes. Do not conclude that Gemini 3.7 shortens whenever a length instruction is present.

## 1. Vanilla USER_TAIL_LENGTH_OWNER_SENTENCE 원문

Hardcoded constant in `src/lib/responseLength.ts`:

```text
이번 응답은 한국어 3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다. 장면에 필요한 내용이 있으면 더 길게 이어간다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.
```

## 2. Actual numeric target owner / code path

### Prompt-visible owner

| item | value |
| --- | --- |
| A. 원문 | 위 상수. 숫자 `3,200자`가 문자열에 박혀 있다. |
| B. 생성 함수 | 생성되지 않는다. `USER_TAIL_LENGTH_OWNER_SENTENCE` 상수. 주입은 `appendCompactTerminalLengthToUserTurn()` |
| C. numeric argument | `_targetInput`는 unused. `targetResponseChars`를 받아도 문장에 넣지 않는다. |
| D. Gemini 3.7 vanilla target | 프롬프트에 보이는 값 = **3,200자**. 공용 상수와 동일. |
| E. 문장에 숫자가 출력되는가 | **예.** `"3,200자 이상"`이 그대로 출력된다. |
| F. `targetResponseChars` ↔ `max_tokens` | RP chat은 `resolveOpenRouterMaxTokens()` / `resolveMaxOutputTokensForTarget()`가 항상 `undefined`. `max_tokens` omit. 숫자 3200과 provider ceiling은 연결되지 않는다. |
| G. 모델별 override 기존 구조 | **없다.** 문장 숫자는 전 모델 공용 상수. Gemini 3.7만 바꿀 훅이 없다. |

Call path:

```text
buildContext()
  → appendCompactTerminalLengthToUserTurn(userTurn, input.targetResponseChars, { modelId, ... })
    → terminalLine = resolveLunaTerminalOutputContract(...) ?? USER_TAIL_LENGTH_OWNER_SENTENCE
    → layout line 다음, user-turn 절대 끝에 1회 append

resolveResponseLengthTarget(_targetInput)
  → 항상 { target: 3200, aimChars: 3200, min: 2700 }
  → normalizeTargetResponseChars(any) === 3200
  → 이 값은 과금/recovery/UI에 쓰이고, USER_TAIL 문장을 만들지 않는다.
```

`UNIFIED_TIER_AIM_CHARS = 3200` (`src/lib/responseLengthConstants.ts`).
`UNIFIED_TIER_MIN_CHARS = 2700` is the soft floor, not printed in the user-tail owner.

Luna single-primary is the only model that replaces this sentence (`LUNA_TERMINAL_OUTPUT_CONTRACT`). Gemini 3.7 is not Luna.

## 3. Gemini 3.7 vanilla target

```text
prompt-visible target = 3,200 Korean chars (hardcoded in USER_TAIL)
resolveResponseLengthTarget().aimChars = 3200
minimum floor (not in the sentence) = 2700
max_tokens = omitted
```

The target is **not** already 4,000+. It is 3,200.

A Gemini-only numeric raise would require a **new** parameterization (template the existing sentence, or a new Gemini-only copy). That is a new structure, not an existing override. This follow-up does not add that structure and does not run a live A/B.

## 4. A/B assembled diff

Not run. There is no existing `GEMINI37_LENGTH_TARGET_VALUE` hook. Inventing one would be a new wording/template experiment.

Offline restore audit (no API) compared Gemini 3.7 vs DeepSeek on the same snapshot. User-tail owner sentence is byte-identical. See `VANILLA_RESTORE_ASSEMBLED_AUDIT.json`.

## 5. A/B 결과

```text
A/B live cells = 0
INVALID_TRANSPORT = n/a
```

## 6. Verdict

```text
KEEP_VANILLA
```

Reasons:

- #432 SYSTEM owner discarded; vanilla user-tail restored.
- Prompt-visible target is already the shared 3,200. No per-model numeric override exists.
- Adding a Gemini-only number would be a new structure / sentence rewrite. Out of scope.
- No new wording experiment.

## 7. Offline restore audit

Required checks:

```text
Gemini 3.7 SYSTEM model-specific length prompt = 0
rejected B sentence = 0
rejected C sentence = 0
generic USER_TAIL_LENGTH_OWNER_SENTENCE = 1
위치 = vanilla와 동일 (layout 다음, user-turn 절대 끝)
```
