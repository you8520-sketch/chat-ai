# DeepSeek V4 Pro thin completion adapter A/B (2026-09-27)

## Git

| | SHA |
|--|-----|
| **EXACT MAIN** | `342d45176b420ab0f9327af704d5ac1242d877e4` |
| **HEAD** | (branch tip) |
| **Source evidence** | PR #1108 transport audit — omitted max_tokens DeepSeek completions ~320–431, `finish_reason=stop` |

## OWNER MAP (main / before)

| Responsibility | Owner | Production status |
|----------------|--------|-------------------|
| Visible numeric length | `USER_TAIL_LENGTH_OWNER_SENTENCE` (`responseLength.ts`) | Active |
| Common prose | `COMMON_PROSE_BLOCK` | Unchanged |
| DeepSeek thinking | `applyCheaperInferenceDeepSeekTrueOffPolicy` | TRUE-OFF |
| Transport ceiling | `resolveOpenRouterMaxTokens` → always omit | Unchanged (#1108) |
| DeepSeek length adapter slot | `resolveDeepSeekLengthAdapterSection` → env `SNPV2_DEEPSEEK_LENGTH_ARM` | **Default OFF (Arm A)** |
| Style-only bottom reminder | `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY` | Active on DeepSeek path |
| `DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK` | legacy combined reminder | **Not injected** on production path |
| `DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA` | detection for opening peel only | Text **not** injected (thin detection only) |
| `DEEPSEEK_SHORT_USER_TURN_BLOCK` | Flash length-stack canary only | Not V4 Pro default |
| `DEEPSEEK_REGEN_LENGTH_BLOCK` | regen path | Separate |

## CONTROL A

Production wire: no DeepSeek length/completion adapter section. `max_tokens` omitted. Thinking TRUE-OFF.

## CANDIDATE B

```
[DEEPSEEK COMPLETION]
현재 응답에서는 공통 길이 목표에 맞는 충분한 장면 단위를 완성한다.
짧은 사용자 입력이나 최근 답변 길이는 현재 응답의 분량 기준이 아니다.
행동·반응·판단·대화·환경과 관계의 다음 변화를 현재 장면의 인과 안에서 충분히 전개한다.
+ anti-filler safety
```

Injected via existing `rule-deepseek-length-adapter` slot when `SNPV2_DEEPSEEK_LENGTH_ARM=B`. V4 Pro only (`isCheaperInferenceDeepSeekV4ProModel`). Token delta ≈ `estimateTokens(block)`.

## QUIET DISTRIBUTION (`quiet_intimacy`, n=5 each)

Artifacts: `/opt/cursor/artifacts/deepseek-completion-quiet/`

| Arm | visible (sorted) | median | avg | completion tokens | finish | adapter |
|-----|------------------|--------|-----|-------------------|--------|---------|
| **A (control)** | 463, 827, 962, 1102, 1251 | **962** | 921 | 343–947 | all stop | 0 |
| **B (candidate)** | 300, 403, 409, 513, 677 | **409** | 460 | 211–510 | all stop | 1 |

### Quiet gate: **FAIL**

- B does **not** increase useful visible prose; distribution shifts **down**.
- No NPC intro / emotion-explain inflation observed (heuristic counts 0), but length uplift failed.
- Per STOP: do **not** strengthen wording; do **not** run banter/tension; do **not** enable production.

## BANTER / TENSION

**Not run** (quiet gate failed).

## V4.1 FLASH

**Not run.**

## PRODUCTION OWNER

**Not promoted.** Default remains Arm A (null). Experiment env path left for future diagnostics only; Arm B wording updated to completion candidate for reproducibility of this FAIL.

## REMOVED LEGACY

**None** — production adapter not adopted → REQUIRED CLEANUP of SNPV2 / SHORT_* / LENGTH_SINGLE_CALL deferred (FOLLOW-UP if a future owner wins).

## PRESERVED

COMMON PROSE, USER_TAIL numeric owner, DeepSeek TRUE-OFF, Gemini untouched, routing/billing/regen.

## FINAL CLASSIFICATION

**ROOT_CAUSE_UNCONFIRMED**

Thin completion prompt adapter alone does not fix DeepSeek V4 Pro premature stop on quiet fixture. Under-length remains a provider/model early-completion behavior relative to USER_TAIL target, not solved by this single adapter.
