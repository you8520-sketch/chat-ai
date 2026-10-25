# Interpretation addendum — PR #620 frozen RAW (do not edit RAW)

This addendum corrects **interpretation only**. Frozen files under `raw/`, `requests/`, and turn `meta/*.json` in PR #620 are unchanged.

## 1. `VISIBLE_ASSISTANT_RESPONSES_T3` label

**Mislabeled in `COMPACT_REPORT.json`.**

| Field | Incorrect reading | Correct semantics |
|-------|-------------------|-------------------|
| `VISIBLE_ASSISTANT_RESPONSES_T3=3` | “three new T3 assistant responses” | Count of **all** non-greeting assistant rows in chat after T3 completes (T1 + T2 + T3 = 3) |
| `T3_NEW_VISIBLE_ASSISTANT_RESPONSES` | — | **1** (single new assistant row from T3) |
| `TOTAL_NON_GREETING_ASSISTANT_MESSAGES_AFTER_T3` | — | **3** |

This is **not** a product multiple-response failure.

## 2. Primary median and T3 gold length ratio

Frozen visible char counts (unchanged):

- T1: **3473**
- T2: **3173**
- T3 Gemini gold: **2651**

**Correct primary median:** `(3473 + 3173) / 2 = **3323**`  
(not 3173 from T2 alone)

**T3_GEMINI_GOLD_LENGTH_RATIO:** `2651 / 3323 ≈ 0.798`

Do not overwrite frozen metrics in `COMPACT_REPORT.json`; use this addendum for corrected baselines.

## 3. Truncation semantics audit (T3 Gemini primary)

See `TRUNCATION_SEMANTICS_AUDIT.json` in the counterfactual replay audit folder for the full trace. Summary:

| Field | Value |
|-------|--------|
| `STAGE_TRUNCATED_OWNER` | `src/lib/openRouterAdult.ts` — `truncated = needsResponseLengthFix(mergedText, usage.finishReason, targetResponseChars)` |
| `STAGE_TRUNCATED_MEANING` | Server heuristic “response needs length/incompleteness fix” — **not** provider `max_tokens` termination |
| `ACTUAL_PROVIDER_LENGTH_TERMINATION` | **false** (`finishReason=stop`) |
| `POSTPROCESS_REMOVAL_ONLY` | **true** — provider stream ended with trailing internal tag `\n\n[태그: 침실]`; that suffix makes `endsAtCompleteSentence` false on pre-strip `mergedText`, so `truncated=true` in `usage.stages[]`. After `stripInternalTagLeakage` / persisted visible, prose is complete and `needsResponseLengthFix` is false |
| `OTHER_REASON` | Harness deterministic alarm `TRUNCATION` in `run-t1-t2-t3-freeze.mjs` only regex-matches `finishReason` (`max_tokens`, `length`, etc.) — so meta alarm `TRUNCATION=false` while stage `truncated=true` |
