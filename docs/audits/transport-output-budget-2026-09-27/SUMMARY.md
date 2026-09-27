# Transport output budget audit (2026-09-27)

## Git

| | SHA |
|--|-----|
| **EXACT MAIN** | `374b066a2815fdb8fee2179d3844ce38d847916d` |
| **Probe HEAD** | (branch commit) |

## Owner map (main)

| Responsibility | Canonical owner |
|----------------|-----------------|
| Visible length **target** (chars, user tail) | `responseLength.ts` — `targetResponseChars`, `USER_TAIL_LENGTH_OWNER_SENTENCE`, `buildLengthInstruction` |
| Visible length **continuation** | `route.ts` — `needsVisibleLengthContinuation`, length supplement (separate API policy) |
| Transport **max_tokens** | `openRouterClient.resolveOpenRouterMaxTokens` → `buildOpenRouterRequestBody` → `normalizeOpenRouterGenerationParams` |
| CheaperInference wire | `adaptCheaperInferenceChatBody` / `applyCheaperInferenceModelReasoningPolicy` |
| Gemini 3.1 reasoning | `reasoning_effort: "low"` (unchanged in probe) |
| DeepSeek V4 Pro thinking | `applyCheaperInferenceDeepSeekTrueOffPolicy` — thinking disabled, `reasoning_effort: "none"` |
| Stream / final visible | `chatDisplayLength.visibleAssistantDisplayCharCount`; route post-process (no transport) |
| Final clamp / billing chars | `billableOutputChars`, catastrophic short recovery in `route.ts` |

**Separation:** USER_TAIL owns *desired* scene length; transport owns *provider completion ceiling* only. Today `resolveOpenRouterMaxTokens()` returns **`undefined`** always → `max_tokens` omitted on wire.

## Probe design

- Script: `scripts/transport-maxtok-abc-probe.ts`
- Fixture: `quiet_intimacy` (prose diet synthetic)
- Same production `buildContext` + `assemblePrimaryRpRequest` (CheaperInference)
- Arms: **omitted** | **4096** | **8192** — only `max_tokens` differs; prompt hash identical per model
- 3 reps × 3 arms × 2 models = 18 calls
- Artifacts: `/opt/cursor/artifacts/transport-maxtok-quiet/`

## Results (visible chars, quiet fixture)

### Gemini 3.1 Pro (`gemini-3.1-pro-preview`, `reasoning_effort=low`)

| Arm | visible (3 reps) | avg | completion tokens | reasoning tokens | finish |
|-----|------------------|-----|-------------------|------------------|--------|
| omitted | 1591, 2262, 2065 | **1973** | 3704, 2647, 3237 | 2701, 1226, 1971 | stop |
| 4096 | 773, 1286, 1447 | **1169** | 2044, 2253, 3102 | 1552, 1428, 2165 | stop |
| 8192 | 1993, 1500, 1174 | **1556** | 4024, 3355, 3285 | 2789, 2429, 2535 | stop |

### DeepSeek V4 Pro (`deepseek-v4-pro-0813`, thinking OFF)

| Arm | visible (3 reps) | avg | completion tokens | finish |
|-----|------------------|-----|-------------------|--------|
| omitted | 562, 415, 482 | **486** | 431, 320, 355 | stop |
| 4096 | 707, 1964, 593 | **1088** | 527, 1457, 439 | stop |
| 8192 | 408, 446, 932 | **595** | 311, 335, 696 | stop |

## Provider-bound payload proof

- `omitted`: no `max_tokens` key; `reasoning_effort: "low"` (Gemini) or thinking disabled (DeepSeek)
- `4096`/`8192`: single `max_tokens` field only (no `max_completion_tokens` duplicate)
- Prompt equivalence SHA256 identical across arms per model (`prompt-equivalence-hash.txt`)

## Interpretation

1. **Implicit 2048 transport cap (hypothesis): NOT confirmed** on this benchmark path.
   - Gemini **omitted** runs routinely report **>2048 completion tokens** (e.g. 3704) with `finish_reason=stop`.
   - DeepSeek **omitted** runs report **~320–431 completion tokens** — far below 2048, so under-length is **early stop / model behavior**, not a hidden ceiling.
2. **Explicit `max_tokens=4096` on Gemini 3.1** did **not** improve visible length; average **worse** than omitted (reasoning + visible share one budget).
3. **DeepSeek:** `4096` raised average visible vs omitted but **high variance** and still **below** 3200 char target; **8192** did not beat 4096 on average.
4. **No production transport patch applied** — no stable winning ceiling; Gemini Common Prose unchanged.

## DeepSeek thin adapter

**NEEDED: NO** (this phase) — transport-first evidence does not show reliable normalization; adapter A/B deferred per STOP (no prompt adapter without transport winner).

## FINAL CLASSIFICATION

**ROOT_CAUSE_UNCONFIRMED** for “implicit 2048 default cap causes Main RP under-length” on CheaperInference Chat Completions with current wire.

Follow-up (separate): provider-specific `max_completion_tokens` vs reasoning split; banter/tension fixtures; DeepSeek adapter only if transport ceiling proven binding.
