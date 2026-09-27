# Legacy Main RP prose diet — summary (2026-09-27)

- EXACT MAIN: `c127d3030f50d5b8214cf87b920bf44a5503d80c`
- Audit reference: PR #1091 (evidence only; no artifacts copied)
- Harness: `scripts/prose-diet-live-compare.ts` (chat-route default wire: `buildContext` → scene directive → third-person POV → `assemblePrimaryRpRequest` with scene server controls). Benchmark key only.
- Raw outputs are not committed. Cursor assigns no scores; numbers below are counts.

## Prompt change

| Before (main) | After |
|---|---|
| `[NARRATION REGISTER]` `[SCENE FLOW]` `[RHYTHM]` `[SENSATION]` `[IMMERSIVE PROSE]` `[WEBNOVEL BREATH]` | `[COMMON PROSE]` (599 local tok, cap 600) + `[SCENE FLOW]` |
| DeepSeek V4 Pro / V4.1 Flash user turn: `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY` (318 tok) | removed (optional momentum block unchanged) |

`[SCENE FLOW]` is kept because the production wire replaces it with `[SCENE PACING]` on interactive character turns.

## Token delta (local `estimateTokens`, production-wire payload, quiet fixture)

| model | wire system | common prose owner | prose bundle | model style adapter | current user turn | DeepSeek reminder |
|---|---|---|---|---|---|---|
| DeepSeek V4 Pro | 8769 → 7590 (−1179) | 1781 → 599 | 2367 → 1188 | 368 → 50 | 1584 → 1266 (−318) | 318 → 0 |
| DeepSeek V4.1 Flash | 8769 → 7590 (−1179) | 1781 → 599 | 2367 → 1188 | 368 → 50 | 1584 → 1266 (−318) | 318 → 0 |
| Gemini 3.1 Pro | 8789 → 7610 (−1179) | 1781 → 599 | 2367 → 1188 | 275 → 275 (agency) | 1266 → 1266 | 0 |
| Gemini 3.7 Flash | 8513 → 7334 (−1179) | 1781 → 599 | 2367 → 1188 | 0 | 1266 → 1266 | 0 |
| GPT-5.6 Terra | 8513 → 7334 (−1179) | 1781 → 599 | 2367 → 1188 | 0 | 1266 → 1266 | 0 |
| Claude Opus 5.5 | 8513 → 7334 (−1179) | 1781 → 599 | 2367 → 1188 | 0 | 1266 → 1266 | 0 |

"common prose owner" before = the five style blocks as sent on the wire (`[SCENE FLOW]` already swapped for `[SCENE PACING]`). DeepSeek model style adapter after = appearance-variation rule (50) only.

Provider-reported `prompt_tokens` (mean over all live samples): DeepSeek V4 Pro 6810 → 5680, V4.1 Flash 6828 → 5681, Gemini 3.1 5808 → 5011, Gemini 3.7 5656 → 4860, Terra 5805 → 4990, Opus 5.5 9580 → 8293.

## Visible chars per fixture (median, BEFORE main vs FINAL head)

| model | quiet | banter | tension | all-sample mean |
|---|---|---|---|---|
| DeepSeek V4 Pro (n 1 → 2) | 536 → 424 | 691 → 641 | 639 → 769 | 622 → 611 |
| DeepSeek V4.1 Flash (n 1 → 2) | 1978 → 1433 | 1171 → 1943 | 1987 → 2163 | 1712 → 1846 |
| Gemini 3.1 Pro (n 4 → 3) | 2280 → 948 | 1890 → 873 | 1305 → 2541 | 2041 → 1355 |
| Gemini 3.7 Flash (n 3 → 2) | 2034 → 1790 | 1490 → 1981 | 2127 → 2100 | 1950 → 1957 |
| GPT-5.6 Terra (n 3 → 3) | 2039 → 1598 | 1214 → 1220 | 2082 → 1924 | 1742 → 1732 |
| Claude Opus 5.5 (n 3 → 2) | 2784 → 2404 | 2770 → 2086 | 2652 → 3138 | 2756 → 2542 |

## Objective annotations (occurrences per 1000 non-space chars, all samples)

| model | arm | abstract expl. | inner thought | backstory recall | face/body | habit | env/sensory | fragment paras |
|---|---|---|---|---|---|---|---|---|
| DeepSeek V4 Pro | BEFORE / FINAL | 0.00 / 0.74 | 0.00 / 0.37 | 0 / 0 | 5.79 / 6.99 | 3.62 / 3.68 | 17.38 / 11.77 | 0 / 0 |
| DeepSeek V4.1 Flash | BEFORE / FINAL | 0.53 / 1.10 | 0.53 / 0.24 | 0 / 0.12 | 6.35 / 6.61 | 4.76 / 3.80 | 13.48 / 13.59 | 0.26 / 0.12 |
| Gemini 3.1 Pro | BEFORE / FINAL | 0.27 / 0.44 | 0.49 / 0.77 | 1.69 / 1.86 | 4.59 / 5.79 | 3.71 / 4.48 | 11.53 / 14.76 | 0.05 / 0.11 |
| Gemini 3.7 Flash | BEFORE / FINAL | 0.53 / 0.46 | 0.31 / 0.23 | 1.45 / 1.37 | 5.72 / 5.14 | 3.13 / 3.54 | 12.51 / 11.31 | 0 / 0.11 |
| GPT-5.6 Terra | BEFORE / FINAL | 0.60 / 0.61 | 0.52 / 0.09 | 0.09 / 0 | 4.65 / 4.69 | 2.67 / 2.96 | 14.57 / 13.56 | 0.34 / 0.26 |
| Claude Opus 5.5 | BEFORE / FINAL | 0.77 / 0.98 | 0.27 / 0.36 | 0.44 / 0.27 | 3.88 / 4.80 | 3.28 / 4.09 | 13.40 / 14.05 | 0 / 0.09 |

Narration register (polite endings outside quotes): 0 real hits in every arm; the heuristic's only hits were `…아니다.` false positives. Counts are regex heuristics — use raw text for judgement.

## DeepSeek reminder A/B (compact owner, reminder ON vs OFF, n = 3 each)

| model | visible chars ON / OFF | abstract expl. | inner thought | fragment paras | habit | env/sensory |
|---|---|---|---|---|---|---|
| V4 Pro | 3723 / 3146 (total) | 0.27 / 0.64 | 0 / 0 | 0 / 0 | 4.83 / 5.40 | 14.77 / 14.94 |
| V4.1 Flash | 12732 / 12875 (total) | 1.65 / 1.32 | 0.63 / 1.24 | 0.16 / 0.39 | 4.79 / 3.88 | 13.51 / 13.90 |

No register or layout regression and no fragment/one-line paragraph spam with the reminder OFF. V4.1 Flash banter showed more narrator trait exposition in 1 of 3 OFF samples; ON samples also contain comparable inner explanation. Decision: reminder removed.

## Open finding — Gemini 3.1 Pro calm-scene length

Gemini 3.1 visible length tracks its reasoning-token share (samples with no reported reasoning run 3000–4500 chars). Excluding those, quiet + banter median is about 1520 chars before vs about 915 after (6 of 6 final samples under 1100). Texture (environment, habit, gaze, sensory, dialogue voice) is present in the final samples. This is flagged for review, not patched in this PR.

## Separate follow-ups (not in this PR)

- DeepSeek V4 Pro response-length adherence / provider completion behaviour (≈300–1100 visible chars in every arm).
- Dead DeepSeek strings: `DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK`, SHORT HISTORY / SHORT USER / REGEN, `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY`, future-boundary module.
- Dormant VNext / Shared Novel V2 / Muse M1 prose bodies still carry the old block layout.
- `scenePacingController` fallback anchors and `proseStyleStep2Variants` still reference retired headers (non-production paths).
- Split prose vs content-policy accounting inside `buildAdvancedProseNsfwGuidelines`.
